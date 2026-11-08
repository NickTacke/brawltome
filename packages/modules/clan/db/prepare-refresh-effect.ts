import type { Database } from '@brawltome/foundation'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { type ClanEffectPreparation, type ClanRefreshEffect, effectPreparation } from '../domain/refresh-effect'
import { excluded } from './excluded'
import { lockRefreshEffect, refreshEffectStateColumns } from './refresh-effect-fence'
import { refreshEffects } from './tables'

const isNewerLease = sql`${refreshEffects.leaseToken} < ${excluded(refreshEffects.leaseToken)}`

// the same holder renewing its lease, before it has published or been revoked
const isLongerSameLease = and(
  eq(refreshEffects.leaseToken, excluded(refreshEffects.leaseToken)),
  isNull(refreshEffects.revokedAt),
  isNull(refreshEffects.appliedAt),
  lt(refreshEffects.leaseExpiresAt, excluded(refreshEffects.leaseExpiresAt)),
)

/**
 * Records the worker's lease on a clan section before it calls the source. A newer lease takes the row over and
 * clears the old holder's revoke and publication; an older or revoked lease leaves the row alone and is fenced.
 */
export async function prepareRefreshEffect(
  database: Database,
  effect: ClanRefreshEffect,
): Promise<ClanEffectPreparation> {
  return database.db.transaction(async (transaction) => {
    const [prepared] = await transaction
      .insert(refreshEffects)
      .values({
        operationId: effect.operationId,
        section: effect.section,
        leaseToken: effect.leaseToken,
        leaseExpiresAt: effect.leaseExpiresAt,
      })
      .onConflictDoUpdate({
        target: [refreshEffects.operationId, refreshEffects.section],
        set: {
          leaseToken: excluded(refreshEffects.leaseToken),
          leaseExpiresAt: excluded(refreshEffects.leaseExpiresAt),
          preparedAt: sql`clock_timestamp()`,
          revokedAt: sql`CASE WHEN ${isNewerLease} THEN NULL ELSE ${refreshEffects.revokedAt} END`,
          appliedAt: sql`CASE WHEN ${isNewerLease} THEN NULL ELSE ${refreshEffects.appliedAt} END`,
        },
        setWhere: or(isNewerLease, isLongerSameLease),
      })
      .returning(refreshEffectStateColumns)

    // no row back means the stored lease won, so read it under a lock to see why
    const state = prepared ?? (await lockRefreshEffect(transaction, effect))

    return effectPreparation(state, effect.leaseToken)
  })
}

import { and, eq, gt, isNull, type SQL, sql } from 'drizzle-orm'
import {
  type ClanEffectPreparation,
  type ClanRefreshEffect,
  effectPreparation,
  type RefreshEffectState,
} from '../domain/refresh-effect'
import { refreshEffects } from './tables'
import type { Transaction } from './transaction'

// the lease is judged by the database clock, the one that also expires it
const isLeaseActive = sql<boolean>`${refreshEffects.revokedAt} IS NULL AND ${refreshEffects.leaseExpiresAt} > clock_timestamp()`

export const refreshEffectStateColumns = {
  leaseToken: refreshEffects.leaseToken,
  appliedAt: refreshEffects.appliedAt,
  isActive: isLeaseActive,
}

export function matchesRefreshEffect(effect: ClanRefreshEffect): SQL | undefined {
  return and(eq(refreshEffects.operationId, effect.operationId), eq(refreshEffects.section, effect.section))
}

/** Locks the effect row until the transaction ends, so a revoke waits for the publication or fences it. */
export async function lockRefreshEffect(
  transaction: Transaction,
  effect: ClanRefreshEffect,
): Promise<RefreshEffectState | undefined> {
  const [state] = await transaction
    .select(refreshEffectStateColumns)
    .from(refreshEffects)
    .where(matchesRefreshEffect(effect))
    .for('update')

  return state
}

// a write without an effect comes from a caller that holds no lease, such as a test or a backfill
export async function checkRefreshEffect(
  transaction: Transaction,
  effect: ClanRefreshEffect | undefined,
): Promise<ClanEffectPreparation> {
  if (!effect) return 'execute'

  const state = await lockRefreshEffect(transaction, effect)

  return effectPreparation(state, effect.leaseToken)
}

/** Marks the effect applied in the publishing transaction, and throws when the lease ran out since it was checked. */
export async function requireRefreshEffectApplied(
  transaction: Transaction,
  effect: ClanRefreshEffect | undefined,
): Promise<void> {
  if (!effect) return

  const applied = await transaction
    .update(refreshEffects)
    .set({ appliedAt: sql`clock_timestamp()` })
    .where(
      and(
        matchesRefreshEffect(effect),
        eq(refreshEffects.leaseToken, effect.leaseToken),
        isNull(refreshEffects.appliedAt),
        isNull(refreshEffects.revokedAt),
        gt(refreshEffects.leaseExpiresAt, sql`clock_timestamp()`),
      ),
    )
    .returning({ operationId: refreshEffects.operationId })

  if (applied.length !== 1) {
    throw new Error(
      `publish clan ${effect.section} for operation ${effect.operationId}: the refresh lease expired before publication`,
    )
  }
}

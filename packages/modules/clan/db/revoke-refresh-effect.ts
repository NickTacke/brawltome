import type { Database } from '@brawltome/foundation'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import { matchesRefreshEffect } from './refresh-effect-fence'
import { refreshEffects } from './tables'

/**
 * Takes the lease away from a worker that is still calling the source, so its publication is fenced. An effect that
 * was already applied stays as it is.
 */
export async function revokeRefreshEffect(database: Database, effect: ClanRefreshEffect): Promise<void> {
  await database.db
    .update(refreshEffects)
    .set({
      leaseExpiresAt: sql`LEAST(${refreshEffects.leaseExpiresAt}, clock_timestamp())`,
      revokedAt: sql`COALESCE(${refreshEffects.revokedAt}, clock_timestamp())`,
    })
    .where(
      and(
        matchesRefreshEffect(effect),
        eq(refreshEffects.leaseToken, effect.leaseToken),
        isNull(refreshEffects.appliedAt),
      ),
    )
}

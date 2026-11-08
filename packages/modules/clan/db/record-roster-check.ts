import type { Database } from '@brawltome/foundation'
import { isNull, lte, or } from 'drizzle-orm'
import type { ClanProvenance } from '../domain/provenance'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import { ensureClanIdentity } from './ensure-clan-identity'
import { excluded } from './excluded'
import { checkRefreshEffect } from './refresh-effect-fence'
import { rosterState } from './tables'

export type RosterCheck = {
  clanId: number
  checkedAt: Date
  provenance: ClanProvenance
  effect?: ClanRefreshEffect
}

/**
 * Records a roster check that fetched nothing, leaving the stored members and last success alone. An older check
 * than the one stored changes nothing. Returns false when the lease was lost.
 */
export async function recordRosterCheck(database: Database, check: RosterCheck): Promise<boolean> {
  const { clanId, checkedAt, provenance, effect } = check

  return database.db.transaction(async (transaction) => {
    if ((await checkRefreshEffect(transaction, effect)) !== 'execute') return false

    await ensureClanIdentity(transaction, clanId)

    await transaction
      .insert(rosterState)
      .values({ clanId, checkedAt, checkProvenance: provenance })
      .onConflictDoUpdate({
        target: rosterState.clanId,
        set: {
          checkedAt: excluded(rosterState.checkedAt),
          checkProvenance: excluded(rosterState.checkProvenance),
        },
        setWhere: or(isNull(rosterState.checkedAt), lte(rosterState.checkedAt, excluded(rosterState.checkedAt))),
      })

    return true
  })
}

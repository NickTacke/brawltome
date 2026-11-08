import type { Database } from '@brawltome/foundation'
import { lte } from 'drizzle-orm'
import type { ClanProvenance } from '../domain/provenance'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import { ensureClanIdentity } from './ensure-clan-identity'
import { excluded } from './excluded'
import { checkRefreshEffect } from './refresh-effect-fence'
import { profileState } from './tables'

export type ProfileCheck = {
  clanId: number
  checkedAt: Date
  provenance: ClanProvenance
  effect?: ClanRefreshEffect
}

/**
 * Records a profile check that fetched nothing, leaving the stored profile and last success alone. An older check
 * than the one stored changes nothing. Returns false when the lease was lost.
 */
export async function recordProfileCheck(database: Database, check: ProfileCheck): Promise<boolean> {
  const { clanId, checkedAt, provenance, effect } = check

  return database.db.transaction(async (transaction) => {
    if ((await checkRefreshEffect(transaction, effect)) !== 'execute') return false

    await ensureClanIdentity(transaction, clanId)

    await transaction
      .insert(profileState)
      .values({ clanId, checkedAt, checkProvenance: provenance })
      .onConflictDoUpdate({
        target: profileState.clanId,
        set: {
          checkedAt: excluded(profileState.checkedAt),
          checkProvenance: excluded(profileState.checkProvenance),
        },
        setWhere: lte(profileState.checkedAt, excluded(profileState.checkedAt)),
      })

    return true
  })
}

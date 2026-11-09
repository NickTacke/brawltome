import type { Database } from '@brawltome/foundation'
import type { HeldLease } from '@brawltome/queue'
import type { ClanProfileWrite } from '../domain/guild-stats'
import type { ClanProvenance } from '../domain/provenance'
import { writeProfilePublication } from './publish-profile'
import { writeProfileCheck } from './record-profile-check'
import { recordWeeklySnapshot } from './record-weekly-snapshot'
import { type WeeklySnapshotWriteResult, writeUnderLease } from './weekly-snapshot-lease'

export type StoredWeeklyGuild = {
  weekStarting: string
  profile: ClanProfileWrite
  sourceRank: number | null
  checkedAt: Date
  provenance: ClanProvenance
}

export type SkippedWeeklyGuild = {
  weekStarting: string
  clanId: number
  checkedAt: Date
  provenance: ClanProvenance
}

/**
 * Publishes a clan's profile, saves its points for the week and moves the run past it, in one transaction that
 * also checks the lease, so a retry can't lose or repeat a clan and a lost lease writes none of it.
 */
export async function storeWeeklyGuild(
  database: Database,
  lease: HeldLease,
  guild: StoredWeeklyGuild,
): Promise<WeeklySnapshotWriteResult<'stored'>> {
  const { weekStarting, profile, sourceRank, checkedAt, provenance } = guild

  return writeUnderLease(database, lease, async (transaction) => {
    await writeProfilePublication(transaction, { profile, checkedAt, provenance })

    const record = { weekStarting, clanId: profile.clanId, guildPoints: profile.guildPoints, sourceRank }

    await recordWeeklySnapshot(transaction, record)

    return 'stored' as const
  })
}

/** Records a clan's failed profile check and moves the run past it, which misses the week, under the lease. */
export async function skipWeeklyGuild(
  database: Database,
  lease: HeldLease,
  guild: SkippedWeeklyGuild,
): Promise<WeeklySnapshotWriteResult<'skipped'>> {
  const { weekStarting, clanId, checkedAt, provenance } = guild

  return writeUnderLease(database, lease, async (transaction) => {
    await writeProfileCheck(transaction, { clanId, checkedAt, provenance })
    await recordWeeklySnapshot(transaction, { weekStarting, clanId, guildPoints: null, sourceRank: null })

    return 'skipped' as const
  })
}

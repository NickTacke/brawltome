import type { Database } from '@brawltome/foundation'
import { desc, eq } from 'drizzle-orm'
import type { ClanMember, ClanProfile, ClanSectionState } from '../domain/clan-profile'
import { readOnlySnapshot } from './read-only-snapshot'
import { members, profileState, profiles, rosterState } from './tables'
import type { Transaction } from './transaction'

const rosterStateColumns = {
  checkedAt: rosterState.checkedAt,
  checkProvenance: rosterState.checkProvenance,
  lastSuccessAt: rosterState.lastSuccessAt,
  lastSuccessProvenance: rosterState.lastSuccessProvenance,
}

async function readRosterState(transaction: Transaction, clanId: number): Promise<ClanSectionState | null> {
  const [state] = await transaction.select(rosterStateColumns).from(rosterState).where(eq(rosterState.clanId, clanId))

  return state ?? null
}

// highest xp first, ties by player id
async function readMembers(transaction: Transaction, clanId: number): Promise<ClanMember[]> {
  return transaction
    .select({
      brawlhallaId: members.brawlhallaId,
      name: members.name,
      rank: members.rank,
      joinDate: members.joinDate,
      xp: members.xp,
      guildPoints: members.guildPoints,
    })
    .from(members)
    .where(eq(members.clanId, clanId))
    .orderBy(desc(members.xp), members.brawlhallaId)
}

async function readProfile(transaction: Transaction, clanId: number) {
  const [profile] = await transaction
    .select({
      clanId: profiles.clanId,
      clanName: profiles.clanName,
      clanCreateDate: profiles.clanCreateDate,
      clanXp: profiles.clanXp,
      clanLifetimeXp: profiles.clanLifetimeXp,
      notice: profiles.notice,
      tags: profiles.tags,
      discordInviteCode: profiles.discordInviteCode,
      guildPoints: profiles.guildPoints,
      isRecruiting: profiles.isRecruiting,
      profile: {
        checkedAt: profileState.checkedAt,
        checkProvenance: profileState.checkProvenance,
        lastSuccessAt: profileState.lastSuccessAt,
        lastSuccessProvenance: profileState.lastSuccessProvenance,
      },
    })
    .from(profiles)
    .innerJoin(profileState, eq(profileState.clanId, profiles.clanId))
    .where(eq(profiles.clanId, clanId))

  return profile
}

/**
 * The stored clan with its section states and members, or null when its profile was never fetched. All three reads
 * share one snapshot, so a refresh that commits meanwhile shows up whole or not at all.
 */
export async function getClanProfile(database: Database, clanId: number): Promise<ClanProfile | null> {
  return database.db.transaction(async (transaction) => {
    const profile = await readProfile(transaction, clanId)

    if (!profile) return null

    const roster = await readRosterState(transaction, clanId)
    const clanMembers = await readMembers(transaction, clanId)

    return { ...profile, roster, members: clanMembers }
  }, readOnlySnapshot)
}

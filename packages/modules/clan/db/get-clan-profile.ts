import type { Database } from '@brawltome/foundation'
import { desc, eq, sql } from 'drizzle-orm'
import type { ClanMember, ClanProfile, ClanSectionState } from '../domain/clan-profile'
import { members, profileState, profiles, rosterState } from './tables'

const rosterStateColumns = {
  checkedAt: rosterState.checkedAt,
  checkProvenance: rosterState.checkProvenance,
  lastSuccessAt: rosterState.lastSuccessAt,
  lastSuccessProvenance: rosterState.lastSuccessProvenance,
}

async function readRosterState(database: Database, clanId: number): Promise<ClanSectionState | null> {
  const [state] = await database.db.select(rosterStateColumns).from(rosterState).where(eq(rosterState.clanId, clanId))

  return state ?? null
}

// highest xp first, ties by player id; xp sorts as text, as it always has, so '99' comes before '100'
async function readMembers(database: Database, clanId: number): Promise<ClanMember[]> {
  return database.db
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
    .orderBy(desc(sql`${members.xp}::text`), members.brawlhallaId)
}

/** The stored clan with its section states and members, or null when its profile was never fetched. */
export async function getClanProfile(database: Database, clanId: number): Promise<ClanProfile | null> {
  const [profile] = await database.db
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

  if (!profile) return null

  const roster = await readRosterState(database, clanId)
  const clanMembers = await readMembers(database, clanId)

  return { ...profile, roster, members: clanMembers }
}

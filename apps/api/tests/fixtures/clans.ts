import type { ClanProvenance } from '@brawltome/clan'
import type { ClanProfileContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'

export type SeedSection = {
  checkedAt: Date | null
  checkProvenance: ClanProvenance
  lastSuccessAt: Date | null
  lastSuccessProvenance: ClanProvenance | null
}

export type SeedProfile = {
  clanName: string
  clanCreateDate: Date
  clanXp: string
  clanLifetimeXp: string
  notice: string | null
  tags: string[] | null
  discordInviteCode: string | null
  guildPoints: string | null
  isRecruiting: boolean | null
}

export type SeedMember = {
  brawlhallaId: number
  name: string | null
  rank: string | null
  joinDate: Date | null
  xp: string
  guildPoints: string | null
}

// each part is optional so a clan can be half fetched, the way a failed first refresh leaves it
export type SeedClan = {
  clanId: number
  profile: SeedProfile | null
  profileState: SeedSection | null
  rosterState: SeedSection | null
  members: SeedMember[]
}

export type ClanScenario = {
  clan: SeedClan
  expected: ClanProfileContract | null
}

const guildStats = { source: 'v1-guild-stats', outcome: 'success' } as const
const guildMembers = { source: 'v1-guild-members', outcome: 'success' } as const

export async function seedClan(database: Database, clan: SeedClan): Promise<void> {
  const sql = database.sql

  await sql`INSERT INTO clans.clans (clan_id) VALUES (${clan.clanId})`

  if (clan.profile) {
    const profile = clan.profile

    await sql`
      INSERT INTO clans.profiles
        (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp, notice, tags,
         discord_invite_code, guild_points, is_recruiting)
      VALUES
        (${clan.clanId}, ${profile.clanName}, ${profile.clanCreateDate}, ${profile.clanXp},
         ${profile.clanLifetimeXp}, ${profile.notice}, ${profile.tags === null ? null : sql.json(profile.tags)},
         ${profile.discordInviteCode}, ${profile.guildPoints}, ${profile.isRecruiting})
    `
  }

  if (clan.profileState) {
    const state = clan.profileState

    await sql`
      INSERT INTO clans.profile_state
        (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
      VALUES
        (${clan.clanId}, ${state.checkedAt}, ${sql.json(state.checkProvenance)}, ${state.lastSuccessAt},
         ${state.lastSuccessProvenance === null ? null : sql.json(state.lastSuccessProvenance)})
    `
  }

  if (clan.rosterState) {
    const state = clan.rosterState

    await sql`
      INSERT INTO clans.roster_state
        (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
      VALUES
        (${clan.clanId}, ${state.checkedAt}, ${sql.json(state.checkProvenance)}, ${state.lastSuccessAt},
         ${state.lastSuccessProvenance === null ? null : sql.json(state.lastSuccessProvenance)})
    `
  }

  for (const member of clan.members) {
    await sql`
      INSERT INTO clans.members (clan_id, brawlhalla_id, name, rank, join_date, xp, guild_points)
      VALUES (${clan.clanId}, ${member.brawlhallaId}, ${member.name}, ${member.rank}, ${member.joinDate},
              ${member.xp}, ${member.guildPoints})
    `
  }
}

// every field set, a failed latest check next to an older success, migration evidence inside the stored provenance,
// and members that tie on xp
export const completeClan: ClanScenario = {
  clan: {
    clanId: 101,
    profile: {
      clanName: 'Complete Clan',
      clanCreateDate: new Date('2024-03-05T10:20:30.000Z'),
      clanXp: '900719925474099312345',
      clanLifetimeXp: '1801439850948198711110',
      notice: 'Welcome',
      tags: ['competitive', 'eu'],
      discordInviteCode: 'abc123',
      guildPoints: '900719925474099355555',
      isRecruiting: true,
    },
    profileState: {
      checkedAt: new Date('2026-08-10T12:00:00.000Z'),
      checkProvenance: {
        source: 'v1-guild-stats',
        outcome: 'ambiguous-failure',
        sourceTable: 'clan',
        sourceKey: '101',
        archiveChecksum: 'a'.repeat(64),
      },
      lastSuccessAt: new Date('2026-08-10T09:00:00.000Z'),
      lastSuccessProvenance: guildStats,
    },
    rosterState: {
      checkedAt: new Date('2026-08-10T11:00:00.000Z'),
      checkProvenance: guildMembers,
      lastSuccessAt: new Date('2026-08-10T11:00:00.000Z'),
      lastSuccessProvenance: {
        source: 'legacy-import',
        outcome: 'legacy-unknown',
        legacyTimestamp: '2026-08-01T00:00:00.000Z',
        sourceTables: ['clan_member', 'player_clan'],
        archiveChecksums: ['b'.repeat(64)],
      },
    },
    // stored out of order
    members: [
      member(5000, 'Echo', '100'),
      member(15, 'Delta', '99'),
      member(900, 'Charlie', '100'),
      member(7, 'Alpha', '900719925474099312345'),
      member(30, 'Bravo', '100'),
      member(20, 'Zulu', '100'),
    ],
  },
  expected: {
    clanId: 101,
    clanName: 'Complete Clan',
    clanCreateDate: '2024-03-05T10:20:30.000Z',
    clanXp: '900719925474099312345',
    clanLifetimeXp: '1801439850948198711110',
    notice: 'Welcome',
    tags: ['competitive', 'eu'],
    discordInviteCode: 'abc123',
    guildPoints: '900719925474099355555',
    isRecruiting: true,
    profile: {
      checkedAt: '2026-08-10T12:00:00.000Z',
      checkProvenance: { source: 'v1-guild-stats', outcome: 'ambiguous-failure' },
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastSuccessProvenance: guildStats,
    },
    roster: {
      checkedAt: '2026-08-10T11:00:00.000Z',
      checkProvenance: guildMembers,
      lastSuccessAt: '2026-08-10T11:00:00.000Z',
      lastSuccessProvenance: {
        source: 'legacy-import',
        outcome: 'legacy-unknown',
        legacyTimestamp: '2026-08-01T00:00:00.000Z',
      },
    },
    // today's order, not the intended one: the query selects xp::text, so ORDER BY xp sorts the text output column
    // and 99 comes before 9007... and before every 100; ties break by player id
    members: [
      expectedMember(15, 'Delta', '99'),
      expectedMember(7, 'Alpha', '900719925474099312345'),
      expectedMember(20, 'Zulu', '100'),
      expectedMember(30, 'Bravo', '100'),
      expectedMember(900, 'Charlie', '100'),
      expectedMember(5000, 'Echo', '100'),
    ],
  },
}

// a clan imported from the old database: nullable profile columns, a check with a legacy timestamp, no success yet,
// and a roster state that was never checked
export const legacyClan: ClanScenario = {
  clan: {
    clanId: 102,
    profile: {
      clanName: 'Legacy Clan',
      clanCreateDate: new Date('2021-01-02T03:04:05.000Z'),
      clanXp: '0',
      clanLifetimeXp: '0',
      notice: null,
      tags: null,
      discordInviteCode: null,
      guildPoints: null,
      isRecruiting: null,
    },
    profileState: {
      checkedAt: new Date('2026-08-01T00:00:00.000Z'),
      checkProvenance: {
        source: 'legacy-import',
        outcome: 'legacy-unknown',
        legacyTimestamp: '2026-08-01T00:00:00.000Z',
      },
      lastSuccessAt: null,
      lastSuccessProvenance: null,
    },
    rosterState: {
      checkedAt: null,
      checkProvenance: { source: 'legacy-import', outcome: 'legacy-unknown' },
      lastSuccessAt: null,
      lastSuccessProvenance: null,
    },
    members: [],
  },
  expected: {
    clanId: 102,
    clanName: 'Legacy Clan',
    clanCreateDate: '2021-01-02T03:04:05.000Z',
    clanXp: '0',
    clanLifetimeXp: '0',
    notice: null,
    tags: null,
    discordInviteCode: null,
    guildPoints: null,
    isRecruiting: null,
    profile: {
      checkedAt: '2026-08-01T00:00:00.000Z',
      checkProvenance: {
        source: 'legacy-import',
        outcome: 'legacy-unknown',
        legacyTimestamp: '2026-08-01T00:00:00.000Z',
      },
      lastSuccessAt: null,
      lastSuccessProvenance: null,
    },
    roster: {
      checkedAt: null,
      checkProvenance: { source: 'legacy-import', outcome: 'legacy-unknown' },
      lastSuccessAt: null,
      lastSuccessProvenance: null,
    },
    members: [],
  },
}

// members whose name, rank, join date and guild points were never recorded
export const sparseMembersClan: ClanScenario = {
  clan: {
    ...plainClan(103, 'Sparse Clan', new Date('2026-08-10T11:30:00.000Z'), new Date('2026-08-10T11:30:00.000Z')),
    members: [
      { brawlhallaId: 41, name: null, rank: null, joinDate: null, xp: '8', guildPoints: null },
      { brawlhallaId: 40, name: null, rank: null, joinDate: null, xp: '8', guildPoints: null },
      {
        brawlhallaId: 42,
        name: 'Named',
        rank: 'Member',
        joinDate: new Date('2025-05-06T07:08:09.000Z'),
        xp: '9',
        guildPoints: '4',
      },
    ],
  },
  expected: {
    ...plainClanResponse(
      103,
      'Sparse Clan',
      new Date('2026-08-10T11:30:00.000Z'),
      new Date('2026-08-10T11:30:00.000Z'),
    ),
    members: [
      {
        brawlhallaId: 42,
        name: 'Named',
        rank: 'Member',
        joinDate: '2025-05-06T07:08:09.000Z',
        xp: '9',
        guildPoints: '4',
      },
      { brawlhallaId: 40, name: null, rank: null, joinDate: null, xp: '8', guildPoints: null },
      { brawlhallaId: 41, name: null, rank: null, joinDate: null, xp: '8', guildPoints: null },
    ],
  },
}

// a profile that was fetched but whose roster never was
export const profileOnlyClan: ClanScenario = {
  clan: plainClan(104, 'Profile Only', new Date('2026-08-10T11:30:00.000Z'), null),
  expected: plainClanResponse(104, 'Profile Only', new Date('2026-08-10T11:30:00.000Z'), null),
}

// the clan identity exists but nothing was ever fetched
export const identityOnlyClan: ClanScenario = {
  clan: { clanId: 105, profile: null, profileState: null, rosterState: null, members: [] },
  expected: null,
}

// a failed first check left a profile state and a roster behind, but no profile
export const unpublishedProfileClan: ClanScenario = {
  clan: {
    clanId: 106,
    profile: null,
    profileState: {
      checkedAt: new Date('2026-08-10T11:30:00.000Z'),
      checkProvenance: { source: 'v1-guild-stats', outcome: 'ambiguous-failure' },
      lastSuccessAt: null,
      lastSuccessProvenance: null,
    },
    rosterState: {
      checkedAt: new Date('2026-08-10T11:30:00.000Z'),
      checkProvenance: guildMembers,
      lastSuccessAt: new Date('2026-08-10T11:30:00.000Z'),
      lastSuccessProvenance: guildMembers,
    },
    members: [member(61, 'Orphan', '5')],
  },
  expected: null,
}

// a clan whose profile and roster were last fetched at the given times; a null roster time means no roster state
export function plainClan(
  clanId: number,
  clanName: string,
  profileSuccessAt: Date,
  rosterSuccessAt: Date | null,
): SeedClan {
  return {
    clanId,
    profile: {
      clanName,
      clanCreateDate: new Date('2024-01-01T00:00:00.000Z'),
      clanXp: '10',
      clanLifetimeXp: '20',
      notice: '',
      tags: [],
      discordInviteCode: '',
      guildPoints: '0',
      isRecruiting: false,
    },
    profileState: {
      checkedAt: profileSuccessAt,
      checkProvenance: guildStats,
      lastSuccessAt: profileSuccessAt,
      lastSuccessProvenance: guildStats,
    },
    rosterState: rosterSuccessAt
      ? {
          checkedAt: rosterSuccessAt,
          checkProvenance: guildMembers,
          lastSuccessAt: rosterSuccessAt,
          lastSuccessProvenance: guildMembers,
        }
      : null,
    members: [],
  }
}

// what the api returns for plainClan, written out so the expectation does not depend on how the clan was seeded
export function plainClanResponse(
  clanId: number,
  clanName: string,
  profileSuccessAt: Date,
  rosterSuccessAt: Date | null,
): ClanProfileContract {
  return {
    clanId,
    clanName,
    clanCreateDate: '2024-01-01T00:00:00.000Z',
    clanXp: '10',
    clanLifetimeXp: '20',
    notice: '',
    tags: [],
    discordInviteCode: '',
    guildPoints: '0',
    isRecruiting: false,
    profile: {
      checkedAt: profileSuccessAt.toISOString(),
      checkProvenance: guildStats,
      lastSuccessAt: profileSuccessAt.toISOString(),
      lastSuccessProvenance: guildStats,
    },
    roster: rosterSuccessAt
      ? {
          checkedAt: rosterSuccessAt.toISOString(),
          checkProvenance: guildMembers,
          lastSuccessAt: rosterSuccessAt.toISOString(),
          lastSuccessProvenance: guildMembers,
        }
      : null,
    members: [],
  }
}

function member(brawlhallaId: number, name: string, xp: string): SeedMember {
  return { brawlhallaId, name, rank: 'Member', joinDate: new Date('2025-01-01T00:00:00.000Z'), xp, guildPoints: '1' }
}

function expectedMember(brawlhallaId: number, name: string, xp: string): ClanProfileContract['members'][number] {
  return { brawlhallaId, name, rank: 'Member', joinDate: '2025-01-01T00:00:00.000Z', xp, guildPoints: '1' }
}

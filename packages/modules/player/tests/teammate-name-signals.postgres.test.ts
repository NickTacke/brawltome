import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import postgres from 'postgres'
import { createPostgresLeaderboardPlayerNames, playerModule } from '../index'
import { recordTeammateNameSignals, type TeammateName } from '../teammate-name-signals'

let database: TestDatabase
let control: ReturnType<typeof postgres>

const ownerId = 700
const lastRefresh = '2026-10-01T00:00:00Z'
const firstVisit = new Date('2026-10-05T12:00:00Z')
const secondVisit = new Date('2026-10-05T13:00:00Z')
const archiveChecksum = 'a'.repeat(64)

beforeAll(async () => {
  database = await createTestDatabase({ label: 'player_teammate_name_signals', modules: [queueModule, playerModule] })
  control = postgres(database.connectionString, { max: 1, onnotice: () => {} })
}, 20_000)

afterAll(async () => {
  await control?.end()
  await database?.drop()
})

beforeEach(async () => {
  await control`
    TRUNCATE players.ranked_profiles, players.career_profiles, players.discovery_aliases,
      players.leaderboard_name_observations, players.teammate_name_signals CASCADE
  `
})

async function ranked(brawlhallaId: number, name: string) {
  await control`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, ${name}, ${lastRefresh}, ${lastRefresh}, 'EU', 2000, 2100, 'Diamond', 1, 2)
  `
}

async function career(brawlhallaId: number, name: string, source: 'v0-player-snapshot' | 'legacy-v2') {
  await control`
    INSERT INTO players.career_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, snapshot_source, xp, level, xp_percentage, games,
       wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick, snowball_hits, bomb_kos,
       mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
    VALUES
      (${brawlhallaId}, ${name}, ${lastRefresh}, ${lastRefresh}, ${source}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
       0, 0, 0)
  `
}

async function formerName(brawlhallaId: number, name: string) {
  await control`
    INSERT INTO players.discovery_aliases (brawlhalla_id, normalized_alias, display_alias)
    VALUES (${brawlhallaId}, ${name.toLowerCase()}, ${name})
  `
}

const record = (names: TeammateName[], observedAt = firstVisit) =>
  recordTeammateNameSignals(database.sql, { profileBrawlhallaId: ownerId, observedAt, names })

const signals = async () => [
  ...(await control<{ brawlhalla_id: number; player_name: string; profile_brawlhalla_id: number; observed_at: Date }[]>`
    SELECT brawlhalla_id, player_name, profile_brawlhalla_id, observed_at
    FROM players.teammate_name_signals ORDER BY brawlhalla_id
  `),
]

describe('Teammate name signals', () => {
  test('a name we have not seen for a known teammate is recorded with the profile it came from', async () => {
    await ranked(801, 'Old Name')
    await career(802, 'Old Name', 'v0-player-snapshot')

    const recorded = await record([
      { brawlhallaId: 801, playerName: 'New Name' },
      { brawlhallaId: 802, playerName: 'Other Name' },
    ])

    expect(recorded).toEqual({ recorded: 2 })

    expect(await signals()).toEqual([
      { brawlhalla_id: 801, player_name: 'New Name', profile_brawlhalla_id: ownerId, observed_at: firstVisit },
      { brawlhalla_id: 802, player_name: 'Other Name', profile_brawlhalla_id: ownerId, observed_at: firstVisit },
    ])
  })

  test('a name we already hold for the teammate records nothing', async () => {
    await ranked(801, 'Same Name')
    await ranked(802, 'Müller')
    await ranked(803, ' Padded ')
    // ranked and career can disagree; either one is a name we hold
    await ranked(804, 'Ranked Name')
    await career(804, 'Career Name', 'v0-player-snapshot')
    // a team name can still carry a name the teammate has since changed
    await ranked(805, 'Current Name')
    await formerName(805, 'Former Name')
    // names the old site knew are former names too; the archive tables cannot be cleared, so these ids are used once
    await ranked(806, 'Current Name')
    await ranked(807, 'Current Name')
    await ranked(808, 'Current Name')

    await control`
      INSERT INTO players.legacy_discovery_profiles
        (brawlhalla_id, player_name, region, rating, view_count, observed_at, archive_checksum)
      VALUES (806, 'Old Site Name', 'EU', 1700, 0, ${lastRefresh}, ${archiveChecksum})
    `

    await control`
      INSERT INTO players.legacy_discovery_aliases
        (brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
      VALUES (807, 'old site alias', 'Old Site Alias', ${lastRefresh}, ${archiveChecksum})
    `

    await control`
      INSERT INTO players.legacy_profile_discovery (brawlhalla_id, player_name, observed_at, archive_checksum)
      VALUES (808, 'Old Profile Name', ${lastRefresh}, ${archiveChecksum})
    `

    // the leaderboard name is searchable and waits for its own check
    await ranked(809, 'Current Name')

    await control`
      INSERT INTO players.leaderboard_name_observations (brawlhalla_id, player_name, observed_at)
      VALUES (809, 'Board Name', ${firstVisit})
    `

    const recorded = await record([
      { brawlhallaId: 801, playerName: 'Same Name' },
      { brawlhallaId: 802, playerName: 'MÃ¼ller' },
      { brawlhallaId: 803, playerName: 'Padded' },
      { brawlhallaId: 804, playerName: 'Career Name' },
      { brawlhallaId: 805, playerName: 'Former Name' },
      { brawlhallaId: 806, playerName: 'Old Site Name' },
      { brawlhallaId: 807, playerName: 'Old Site Alias' },
      { brawlhallaId: 808, playerName: 'Old Profile Name' },
      { brawlhallaId: 809, playerName: 'Board Name' },
    ])

    expect(recorded).toEqual({ recorded: 0 })
    expect(await signals()).toEqual([])
  })

  test('a teammate without a live profile records nothing', async () => {
    // never seen, only imported from the old site, only on a leaderboard, or only an alias: no live name to check
    await career(902, 'Imported Name', 'legacy-v2')
    await formerName(904, 'Former Name')

    await control`
      INSERT INTO players.leaderboard_name_observations (brawlhalla_id, player_name, observed_at)
      VALUES (903, 'Board Name', ${lastRefresh})
    `

    const recorded = await record([
      { brawlhallaId: 901, playerName: 'Stranger' },
      { brawlhallaId: 902, playerName: 'New Name' },
      { brawlhallaId: 903, playerName: 'New Name' },
      { brawlhallaId: 904, playerName: 'New Name' },
    ])

    expect(recorded).toEqual({ recorded: 0 })
    expect(await signals()).toEqual([])
  })

  test('a second identical refresh adds nothing, a different name replaces the signal', async () => {
    await ranked(801, 'Old Name')

    await record([{ brawlhallaId: 801, playerName: 'New Name' }])

    expect(await record([{ brawlhallaId: 801, playerName: 'New Name' }], secondVisit)).toEqual({ recorded: 0 })
    expect(await signals()).toMatchObject([{ player_name: 'New Name', observed_at: firstVisit }])

    // an older refresh that lands late never overwrites a newer signal
    expect(await record([{ brawlhallaId: 801, playerName: 'Late Name' }], new Date(lastRefresh))).toEqual({
      recorded: 0,
    })

    expect(await record([{ brawlhallaId: 801, playerName: 'Newer Name' }], secondVisit)).toEqual({ recorded: 1 })
    expect(await signals()).toMatchObject([{ player_name: 'Newer Name', observed_at: secondVisit }])
  })

  test('a leaderboard scan and a team name keep their own observation of the same player', async () => {
    const leaderboard = createPostgresLeaderboardPlayerNames(database)

    await ranked(801, 'Old Name')

    await leaderboard.applyLeaderboardNames({
      observedAt: new Date('2026-10-05T11:00:00Z'),
      players: [{ brawlhallaId: 801, name: 'Cached Name' }],
    })

    await record([{ brawlhallaId: 801, playerName: 'New Name' }])

    // the next scan still shows the cached name, the one after that a new one
    await leaderboard.applyLeaderboardNames({
      observedAt: secondVisit,
      players: [{ brawlhallaId: 801, name: 'Cached Name' }],
    })

    const boardRows = async () => [
      ...(await control<{ player_name: string; previous_player_name: string | null }[]>`
        SELECT player_name, previous_player_name FROM players.leaderboard_name_observations
      `),
    ]

    expect(await boardRows()).toEqual([{ player_name: 'Cached Name', previous_player_name: null }])
    expect(await signals()).toMatchObject([{ brawlhalla_id: 801, player_name: 'New Name' }])

    await leaderboard.applyLeaderboardNames({
      observedAt: new Date('2026-10-05T14:00:00Z'),
      players: [{ brawlhallaId: 801, name: 'New Name' }],
    })

    expect(await boardRows()).toEqual([{ player_name: 'New Name', previous_player_name: 'Cached Name' }])
    expect(await signals()).toMatchObject([{ brawlhalla_id: 801, player_name: 'New Name', observed_at: firstVisit }])
  })
})

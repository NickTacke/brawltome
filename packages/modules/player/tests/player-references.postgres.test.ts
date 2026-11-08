import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { getLegendById, legendSlug } from '@brawltome/game-data'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import postgres from 'postgres'
import { createPostgresPlayerReferences, playerModule } from '../index'

const archiveChecksum = 'a'.repeat(64)
let database: TestDatabase
let control: ReturnType<typeof postgres>

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'player_references',
    modules: [refreshOperationsModule, playerModule],
  })

  control = postgres(database.connectionString, { max: 1 })
}, 20_000)

afterAll(async () => {
  await control?.end()
  await database?.drop()
})

type MainLegend = { id: number; nameKey: string }

async function insertRanked(brawlhallaId: number, name: string, observedAt: string, mainLegend: MainLegend | null) {
  await control`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games,
       ranked_main_legend_id, ranked_main_legend_name_key)
    VALUES
      (${brawlhallaId}, ${name}, ${observedAt}, ${observedAt}, 'EU', 2000, 2100, 'Diamond', 1, 2,
       ${mainLegend?.id ?? null}, ${mainLegend?.nameKey ?? null})
  `
}

async function insertCareer(brawlhallaId: number, name: string, observedAt: string) {
  await control`
    INSERT INTO players.career_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, snapshot_source, xp, level, xp_percentage,
       games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
       snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
    VALUES
      (${brawlhallaId}, ${name}, ${observedAt}, ${observedAt}, 'v0-player-snapshot', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
       0, 0, 0, 0, 0, 0)
  `
}

async function insertLeaderboardName(brawlhallaId: number, name: string, observedAt: string) {
  await control`
    INSERT INTO players.leaderboard_name_observations (brawlhalla_id, player_name, observed_at)
    VALUES (${brawlhallaId}, ${name}, ${observedAt})
  `
}

async function insertAlias(brawlhallaId: number, alias: string, observedAt: string) {
  await control`
    INSERT INTO players.discovery_aliases (brawlhalla_id, normalized_alias, display_alias, observed_at)
    VALUES (${brawlhallaId}, ${alias.toLowerCase()}, ${alias}, ${observedAt})
  `
}

async function insertLegacyAlias(brawlhallaId: number, alias: string, observedAt: string) {
  await control`
    INSERT INTO players.legacy_discovery_aliases
      (brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
    VALUES (${brawlhallaId}, ${alias.toLowerCase()}, ${alias}, ${observedAt}, ${archiveChecksum})
  `
}

describe('player references', () => {
  test('names a player by the newest profile and lists the other names it was seen under', async () => {
    await insertRanked(301, 'Fresh Ranked', '2026-10-05T12:00:00Z', { id: 16, nameKey: 'teros' })
    await insertCareer(301, 'Older Career', '2026-10-01T00:00:00Z')
    await insertAlias(301, 'Older Career', '2026-10-01T00:00:00Z')
    await insertAlias(301, 'FRESH RANKED', '2026-10-05T12:00:00Z')
    await insertAlias(301, 'Sidekick', '2026-09-01T00:00:00Z')
    await insertLegacyAlias(301, 'SIDEKICK', '2025-01-01T00:00:00Z')
    await insertLegacyAlias(301, 'Ancient', '2024-01-01T00:00:00Z')
    await insertLegacyAlias(301, '​', '2024-01-01T00:00:00Z')

    expect(await createPostgresPlayerReferences(database).byId(301)).toEqual({
      brawlhallaId: 301,
      name: 'Fresh Ranked',
      aliases: ['Older Career', 'Sidekick', 'Ancient'],
      bestLegendNameKey: 'teros',
      legacyRating: null,
    })
  })

  test('drops the mojibake spelling of the name from the aliases', async () => {
    await insertCareer(302, 'Müller', '2026-10-05T12:00:00Z')
    await insertAlias(302, 'MÃ¼ller', '2026-10-01T00:00:00Z')

    expect(await createPostgresPlayerReferences(database).byId(302)).toEqual({
      brawlhallaId: 302,
      name: 'Müller',
      aliases: [],
      bestLegendNameKey: null,
    })
  })

  test('names a player seen only on the leaderboard by that name', async () => {
    await insertLeaderboardName(303, 'Leaderboard Climber', '2026-10-05T00:00:00Z')

    expect(await createPostgresPlayerReferences(database).byId(303)).toEqual({
      brawlhallaId: 303,
      name: 'Leaderboard Climber',
      aliases: [],
    })
  })

  test('prefers a leaderboard name over a legacy import, and keeps the import rating and best legend', async () => {
    const legend = getLegendById(3)

    if (!legend) throw new Error('game data has no legend 3')

    await control`
      INSERT INTO players.legacy_profile_discovery
        (brawlhalla_id, player_name, rating, best_legend, observed_at, archive_checksum)
      VALUES (304, 'Imported Name', 1800, 3, '2024-01-01T00:00:00Z', ${archiveChecksum})
    `

    await insertLeaderboardName(304, 'Leaderboard Name', '2026-10-05T00:00:00Z')

    expect(await createPostgresPlayerReferences(database).byId(304)).toEqual({
      brawlhallaId: 304,
      name: 'Leaderboard Name',
      aliases: [],
      bestLegendNameKey: legendSlug(legend.heroId, legend.displayName),
      legacyRating: 1800,
    })
  })

  test('returns null for an unknown player and for one known only by a placeholder name', async () => {
    await insertRanked(305, 'Player 305', '2026-10-05T12:00:00Z', null)

    const references = createPostgresPlayerReferences(database)

    expect(await references.byId(305)).toBeNull()
    expect(await references.byId(306)).toBeNull()
  })
})

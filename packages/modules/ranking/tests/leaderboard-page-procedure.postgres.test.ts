import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createRankingProcedures } from '../api/procedures'
import { rankingModule } from '../index'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

const observedAt = new Date('2026-11-09T12:00:00.000Z')
const nextPublicationAt = new Date('2026-11-09T12:15:00.000Z')
const boardSize = 31
const namedPlayerId = 101
const visitingPlayerRank = 3

let database: TestDatabase

function boardRow(snapshotId: string, rank: number) {
  const isVisitor = rank === visitingPlayerRank

  return {
    snapshot_id: snapshotId,
    mode: '1v1',
    ordinal: rank,
    standing: rank,
    source_rank: rank,
    identity_kind: 'one-vs-one-player',
    player_one_id: 100 + rank,
    player_one_name: `Captured ${rank}`,
    player_two_id: null,
    player_two_name: null,
    region: isVisitor ? 'US-E' : 'EU',
    rating: isVisitor ? 2_900 : 2_500 - rank,
    peak_rating: 2_950,
    wins: 40,
    losses: 10,
    tier: 'Diamond',
  }
}

async function publishEuropeBoard() {
  const generationId = randomUUID()
  const snapshotId = randomUUID()
  const provenance = { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: 1 }
  const sql = database.sql

  await sql`
    INSERT INTO rankings.generations
      (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
       expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
    VALUES (${generationId}, ${randomUUID()}, 'leaderboard-page-test', '1v1', ${observedAt}, ${observedAt},
      ${nextPublicationAt}, 1, 'brawlhalla-v1-ranked-leaderboard', 2, false, ${sql.json(provenance)})
  `

  await sql`
    INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
    VALUES (${snapshotId}, ${generationId}, '1v1', 'EU', ${boardSize})
  `

  const rows = Array.from({ length: boardSize }, (_, index) => boardRow(snapshotId, index + 1))

  await sql`INSERT INTO rankings.snapshot_rows ${sql(rows)}`
  await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
}

async function insertNamedPlayer() {
  await database.sql`
    INSERT INTO players.ranked_profiles (
      brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games,
      ranked_main_legend_id, ranked_main_legend_name_key
    )
    VALUES (
      ${namedPlayerId}, 'Current Name', ${observedAt}, ${observedAt}, 'EU', 2000, 2100, 'Diamond', 1, 2, 3, 'bodvar'
    )
  `
}

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'leaderboard_page_procedure',
    modules: [queueModule, playerModule, rankingModule],
  })

  await publishEuropeBoard()
  await insertNamedPlayer()
}, 30_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

function readPage(input: { mode: '1v1' | '2v2' | 'solo2v2' | '3v3'; region: 'all' | 'EU'; page: number }) {
  const { leaderboardPage } = createRankingProcedures({ database })

  return call(leaderboardPage, input, internalCaller)
}

describe('leaderboardPage', () => {
  test('serves the first 30 rows with current names and best legends', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 1 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(page).toMatchObject({ page: 1, pageSize: 30, hasMore: true, totalRows: boardSize })
    expect(page.entries).toHaveLength(30)

    expect(page.entries[0]).toEqual({
      standing: 1,
      sourceRank: 1,
      identity: {
        type: 'one-vs-one-player',
        player: { brawlhallaId: namedPlayerId, name: 'Current Name', bestLegendNameKey: 'bodvar' },
      },
      region: 'EU',
      rating: 2_499,
      peakRating: 2_950,
      wins: 40,
      losses: 10,
      games: 50,
      tier: 'Diamond',
    })
  })

  test('keeps the name a row captured when the player has no reference', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 1 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(page.entries[1].identity).toEqual({
      type: 'one-vs-one-player',
      player: { brawlhallaId: 102, name: 'Captured 2', bestLegendNameKey: null },
    })
  })

  test('serves a board in stored order, so a visiting player stays at their rank', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 1 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(page.entries.slice(0, 4).map(({ standing, rating }) => ({ standing, rating }))).toEqual([
      { standing: 1, rating: 2_499 },
      { standing: 2, rating: 2_498 },
      { standing: 3, rating: 2_900 },
      { standing: 4, rating: 2_496 },
    ])
  })

  test('serves the rest of the board on the next page', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 2 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(page).toMatchObject({ page: 2, pageSize: 30, hasMore: false, totalRows: boardSize })
    expect(page.entries.map(({ standing }) => standing)).toEqual([31])
  })

  test('says a board has not been published yet', async () => {
    expect(await readPage({ mode: '2v2', region: 'all', page: 1 })).toEqual({
      status: 'unavailable',
      reason: 'not_yet_published',
      mode: '2v2',
      page: 1,
      pageSize: 30,
    })
  })

  test('rejects callers from outside', () => {
    const { leaderboardPage } = createRankingProcedures({ database })

    expect(call(leaderboardPage, { mode: '1v1', region: 'EU', page: 1 }, outsideCaller)).rejects.toThrow()
  })
})

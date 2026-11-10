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
const boardSize = 100
const namedPlayerId = 101

// brawlhalla's order puts a 2,700 on its fourth page of 30 and a 2,490 that ties the tenth row on its fourth too
const ratingOutOfOrder: Record<number, number> = { 92: 2_490, 95: 2_700 }

// the 2,490 deep in the list has more wins than the 2,490 it ties, so the game ranks it first
const winsByRank: Record<number, number> = { 92: 60 }

let database: TestDatabase

function boardRow(snapshotId: string, rank: number) {
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
    region: 'EU',
    rating: ratingOutOfOrder[rank] ?? 2_500 - rank,
    peak_rating: 2_950,
    wins: winsByRank[rank] ?? 40,
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

type Place = { standing: number; sourceRank: number; rating: number }

function places(entries: Place[]): Place[] {
  return entries.map(({ standing, sourceRank, rating }) => ({ standing, sourceRank, rating }))
}

function sourceRanks(entries: Place[]): number[] {
  return entries.map(({ sourceRank }) => sourceRank)
}

describe('leaderboardPage', () => {
  test('serves the first 30 rows with current names and best legends', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 1 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(page).toMatchObject({ page: 1, pageSize: 30, hasMore: true, totalRows: boardSize })
    expect(page.entries).toHaveLength(30)

    expect(page.entries[1]).toEqual({
      standing: 2,
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

    expect(page.entries[2].identity).toEqual({
      type: 'one-vs-one-player',
      player: { brawlhallaId: 102, name: 'Captured 2', bestLegendNameKey: null },
    })
  })

  test('ranks the board by rating, so a high rating deep in the official order leads page 1', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 1 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(places(page.entries.slice(0, 2))).toEqual([
      { standing: 1, sourceRank: 95, rating: 2_700 },
      { standing: 2, sourceRank: 1, rating: 2_499 },
    ])

    expect(page.entries.map(({ standing }) => standing)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
  })

  test('breaks a rating tie by wins, more wins first, as the game does', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 1 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(places(page.entries.slice(10, 13))).toEqual([
      { standing: 11, sourceRank: 92, rating: 2_490 },
      { standing: 12, sourceRank: 10, rating: 2_490 },
      { standing: 13, sourceRank: 11, rating: 2_489 },
    ])
  })

  test('carries the rows pushed off page 1 onto page 2', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 2 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(page.entries[0]).toMatchObject({ standing: 31, sourceRank: 29 })
  })

  test('serves the rest of the board on the last page, without the rows that moved up', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 4 })

    if (page.status === 'unavailable') throw new Error('Expected the published EU board')

    expect(page).toMatchObject({ page: 4, pageSize: 30, hasMore: false, totalRows: boardSize })
    expect(page.entries.map(({ standing }) => standing)).toEqual(Array.from({ length: 10 }, (_, index) => 91 + index))
    expect(sourceRanks(page.entries)).toEqual([89, 90, 91, 93, 94, 96, 97, 98, 99, 100])
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

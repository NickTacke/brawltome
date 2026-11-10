import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { LeaderboardRecentActivityEntry } from '@brawltome/contracts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createRankingProcedures } from '../api/procedures'
import { rankingModule } from '../index'

type Mode = '1v1' | '2v2' | 'solo2v2' | '3v3'
type Standing = { id: number; rating: number; wins: number; losses: number }

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

const minuteMs = 60 * 1000
const scanIntervalMs = 15 * minuteMs
const currentWindow = new Date('2026-11-09T12:00:00.000Z')
const playerCount = 40
const namedPlayerId = 40

let database: TestDatabase

function minutesBefore(minutes: number): Date {
  return new Date(currentWindow.getTime() - minutes * minuteMs)
}

function boardRow(snapshotId: string, mode: Mode, standing: Standing, index: number) {
  const isTeam = mode === '2v2'

  return {
    snapshot_id: snapshotId,
    mode,
    ordinal: index + 1,
    standing: index + 1,
    source_rank: index + 1,
    identity_kind: isTeam ? 'fixed-two-vs-two-team' : identityKinds[mode],
    player_one_id: standing.id,
    player_one_name: `Captured ${standing.id}`,
    player_two_id: isTeam ? standing.id + 1_000 : null,
    player_two_name: isTeam ? `Teammate ${standing.id}` : null,
    region: 'EU',
    rating: standing.rating,
    peak_rating: 3_000,
    wins: standing.wins,
    losses: standing.losses,
    tier: 'Diamond',
  }
}

const identityKinds: Record<Mode, string> = {
  '1v1': 'one-vs-one-player',
  '2v2': 'fixed-two-vs-two-team',
  solo2v2: 'solo-two-vs-two-player',
  '3v3': 'three-vs-three-player',
}

async function publishBoard(mode: Mode, windowAt: Date, standings: Standing[]) {
  const generationId = randomUUID()
  const snapshotId = randomUUID()
  const provenance = { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: 1 }
  const nextPublicationAt = new Date(windowAt.getTime() + scanIntervalMs)
  const sql = database.sql

  await sql`
    INSERT INTO rankings.generations
      (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
       expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
    VALUES (${generationId}, ${randomUUID()}, ${`recent-activity-test:${randomUUID()}`}, ${mode}, ${windowAt},
      ${windowAt}, ${nextPublicationAt}, 1, 'brawlhalla-v1-ranked-leaderboard', 2, false, ${sql.json(provenance)})
  `

  await sql`
    INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
    VALUES (${snapshotId}, ${generationId}, ${mode}, 'EU', ${standings.length})
  `

  const rows = standings.map((standing, index) => boardRow(snapshotId, mode, standing, index))

  await sql`INSERT INTO rankings.snapshot_rows ${sql(rows)}`
  await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
}

function previousStandings(): Standing[] {
  return Array.from({ length: playerCount }, (_, index) => ({
    id: index + 1,
    rating: 2_500 - (index + 1) * 5,
    wins: 50,
    losses: 50,
  }))
}

// everyone won one game for 10 rating, except the players each list is about
const hourChanges: Record<number, Partial<Standing>> = {
  40: { rating: 52, wins: 3, losses: 0 },
  39: { rating: -45, wins: 0, losses: 2 },
  38: { rating: 5, wins: 7, losses: 5 },
  37: { rating: 100, wins: 0, losses: 0 },
  36: { rating: 0, wins: 1, losses: 1 },
}

function currentStandings(): Standing[] {
  const standings = previousStandings().map((standing) => {
    const change = { rating: 10, wins: 1, losses: 0, ...hourChanges[standing.id] }

    return {
      id: standing.id,
      rating: standing.rating + change.rating,
      wins: standing.wins + change.wins,
      losses: standing.losses + change.losses,
    }
  })

  return standings.sort((left, right) => right.rating - left.rating)
}

async function insertNamedPlayer() {
  await database.sql`
    INSERT INTO players.ranked_profiles (
      brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games,
      ranked_main_legend_id, ranked_main_legend_name_key
    )
    VALUES (
      ${namedPlayerId}, 'Current Name', ${currentWindow}, ${currentWindow}, 'EU', 2000, 2100, 'Diamond', 1, 2, 3, 'bodvar'
    )
  `
}

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'recent_activity_procedures',
    modules: [queueModule, playerModule, rankingModule],
  })

  // 1v1 has a full hour of scans
  await publishBoard('1v1', minutesBefore(60), previousStandings())
  await publishBoard('1v1', currentWindow, currentStandings())

  // 2v2 has a full hour in which nobody played
  await publishBoard('2v2', minutesBefore(60), previousStandings())
  await publishBoard('2v2', currentWindow, previousStandings())

  // 3v3 went more than two hours without a scan but has history before that
  await publishBoard('3v3', minutesBefore(180), previousStandings())
  await publishBoard('3v3', minutesBefore(30), previousStandings())
  await publishBoard('3v3', currentWindow, currentStandings())

  // solo 2v2 only started scanning half an hour ago
  await publishBoard('solo2v2', minutesBefore(30), previousStandings())
  await publishBoard('solo2v2', currentWindow, currentStandings())

  await insertNamedPlayer()
}, 30_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

function readPage(input: { mode: Mode; region: 'all' | 'EU'; page: number }) {
  const { recentActivityPage } = createRankingProcedures({ database })

  return call(recentActivityPage, input, internalCaller)
}

function readMovers(input: { mode: Mode; region: 'all' | 'EU' }) {
  const { recentActivityMovers } = createRankingProcedures({ database })

  return call(recentActivityMovers, input, internalCaller)
}

function playerIds(entries: LeaderboardRecentActivityEntry[]): number[] {
  return entries.map(
    ({ identity }) => (identity.type === 'fixed-two-vs-two-team' ? identity.players[0] : identity.player).brawlhallaId,
  )
}

describe('recentActivityPage', () => {
  test('serves the first 30 players who played, highest rating first', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 1 })

    if (page.status === 'unavailable') throw new Error('Expected the 1v1 hour')

    expect(page).toMatchObject({ page: 1, pageSize: 30, hasMore: true, totalRows: playerCount - 1 })
    expect(playerIds(page.entries)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
  })

  test('serves the rest on the next page, with current names', async () => {
    const page = await readPage({ mode: '1v1', region: 'EU', page: 2 })

    if (page.status === 'unavailable') throw new Error('Expected the 1v1 hour')

    expect(page).toMatchObject({ page: 2, hasMore: false, totalRows: playerCount - 1 })
    expect(playerIds(page.entries)).toEqual([31, 40, 32, 33, 34, 35, 36, 38, 39])

    expect(page.entries.find(({ ratingDelta }) => ratingDelta === 52)?.identity).toEqual({
      type: 'one-vs-one-player',
      player: { brawlhallaId: namedPlayerId, name: 'Current Name', bestLegendNameKey: 'bodvar' },
    })
  })

  test('says when an hour ago was never scanned', async () => {
    expect(await readPage({ mode: 'solo2v2', region: 'EU', page: 1 })).toEqual({
      status: 'unavailable',
      reason: 'not_enough_history',
      mode: 'solo2v2',
      region: 'EU',
      page: 1,
      pageSize: 30,
    })
  })

  test('says when scans were missed', async () => {
    expect(await readPage({ mode: '3v3', region: 'EU', page: 1 })).toEqual({
      status: 'unavailable',
      reason: 'scan_gap',
      mode: '3v3',
      region: 'EU',
      page: 1,
      pageSize: 30,
    })
  })

  test('an hour nobody played is empty, not unavailable', async () => {
    expect(await readPage({ mode: '2v2', region: 'EU', page: 1 })).toMatchObject({ totalRows: 0, entries: [] })
  })

  test('rejects callers from outside', () => {
    const { recentActivityPage } = createRankingProcedures({ database })

    expect(call(recentActivityPage, { mode: '1v1', region: 'EU', page: 1 }, outsideCaller)).rejects.toThrow()
  })
})

describe('recentActivityMovers', () => {
  test('ranks climbers across the whole hour, not one page', async () => {
    const movers = await readMovers({ mode: '1v1', region: 'EU' })

    if (movers.status === 'unavailable') throw new Error('Expected the 1v1 hour')

    // the +10s tie, so the higher rating goes first
    expect(playerIds(movers.climbers)).toEqual([40, 1, 2, 3, 4])
    expect(movers.climbers[0]).toMatchObject({ ratingDelta: 52, winsDelta: 3, lossesDelta: 0, gamesDelta: 3 })
  })

  test('lists only players who lost rating as drops, not those who broke even', async () => {
    const movers = await readMovers({ mode: '1v1', region: 'EU' })

    if (movers.status === 'unavailable') throw new Error('Expected the 1v1 hour')

    expect(playerIds(movers.drops)).toEqual([39])
  })

  test('ranks most games by games played, then rating', async () => {
    const movers = await readMovers({ mode: '1v1', region: 'EU' })

    if (movers.status === 'unavailable') throw new Error('Expected the 1v1 hour')

    expect(playerIds(movers.mostGames)).toEqual([38, 40, 36, 39, 1])
  })

  test('leaves out a rating change without games', async () => {
    const movers = await readMovers({ mode: '1v1', region: 'EU' })

    if (movers.status === 'unavailable') throw new Error('Expected the 1v1 hour')

    const listed = [...movers.climbers, ...movers.drops, ...movers.mostGames]

    expect(playerIds(listed)).not.toContain(37)
  })

  test('uses current names', async () => {
    const movers = await readMovers({ mode: '1v1', region: 'EU' })

    if (movers.status === 'unavailable') throw new Error('Expected the 1v1 hour')

    expect(movers.climbers[0].identity).toEqual({
      type: 'one-vs-one-player',
      player: { brawlhallaId: namedPlayerId, name: 'Current Name', bestLegendNameKey: 'bodvar' },
    })
  })

  test('an hour nobody played has empty lists', async () => {
    expect(await readMovers({ mode: '2v2', region: 'EU' })).toMatchObject({
      status: 'available',
      mode: '2v2',
      climbers: [],
      drops: [],
      mostGames: [],
    })
  })

  test('says why an hour cannot be compared', async () => {
    expect(await readMovers({ mode: 'solo2v2', region: 'EU' })).toEqual({
      status: 'unavailable',
      reason: 'not_enough_history',
      mode: 'solo2v2',
      region: 'EU',
    })

    expect(await readMovers({ mode: '3v3', region: 'EU' })).toEqual({
      status: 'unavailable',
      reason: 'scan_gap',
      mode: '3v3',
      region: 'EU',
    })
  })

  test('rejects callers from outside', () => {
    const { recentActivityMovers } = createRankingProcedures({ database })

    expect(call(recentActivityMovers, { mode: '1v1', region: 'EU' }, outsideCaller)).rejects.toThrow()
  })
})

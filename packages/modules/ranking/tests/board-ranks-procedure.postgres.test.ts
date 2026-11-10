import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { leaderboardPageSize } from '@brawltome/contracts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createRankingProcedures } from '../api/procedures'
import { rankingModule } from '../index'
import { leaderboardSourcePageSize } from '../v1-leaderboard-source'

type Mode = '1v1' | 'solo2v2'
type Region = 'EU' | 'US-E' | 'SEA'
type Scope = 'all' | Region
type Listed = { id: number; region: Region; rating: number; wins: number; sourceRank?: number }
type Generation = { mode: Mode; windowAt: Date; isFinalized?: boolean; boards: Partial<Record<Scope, Listed[]>> }

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

const identityKinds: Record<Mode, string> = { '1v1': 'one-vs-one-player', solo2v2: 'solo-two-vs-two-player' }

// every generation here is scanned one page deep, so a board whose last row has this rank was filled by the scan
const scannedPages = 1
const fullScanRows = scannedPages * leaderboardSourcePageSize

// the block brawlhalla lists first on the EU board, by rating, some of it far below the rest of the board
const anna: Listed = { id: 201, region: 'EU', rating: 2_700, wins: 40 }
const bram: Listed = { id: 202, region: 'EU', rating: 2_505, wins: 30 }
const cleo: Listed = { id: 203, region: 'EU', rating: 2_305, wins: 50 }
const atCutOff: Listed = { id: 204, region: 'EU', rating: 2_110, wins: 45 }
const faded: Listed = { id: 205, region: 'EU', rating: 2_050, wins: 20 }
const fallen: Listed = { id: 206, region: 'EU', rating: 1_900, wins: 20 }
const europeFirstBlock = [anna, bram, cleo, atCutOff, faded, fallen]

const visitorRank = 20

// after the first block the EU board starts again near the top and runs by rating down to its last row
function europeRow(sourceRank: number): Listed {
  const rating = 2_540 - 10 * (sourceRank - europeFirstBlock.length - 1)

  return { id: 10_000 + sourceRank, region: sourceRank === visitorRank ? 'US-E' : 'EU', rating, wins: 20 }
}

// plays from US-E and is good enough for the EU board, but is not on the board of their own region
const visitor = europeRow(visitorRank)
// the last row brawlhalla lists: everyone rated at least this high is on the board. ties atCutOff with more wins
const lastListed: Listed = { ...europeRow(fullScanRows), wins: 60 }

const europeBoard = [
  ...europeFirstBlock,
  ...Array.from({ length: fullScanRows - europeFirstBlock.length - 1 }, (_, index) =>
    europeRow(europeFirstBlock.length + index + 1),
  ),
  lastListed,
]

// US-E has fewer players than a scan reads, so its board lists all of them, down to the low row of its first block
const american: Listed = { id: 401, region: 'US-E', rating: 2_750, wins: 60 }
const slipped: Listed = { id: 402, region: 'US-E', rating: 1_500, wins: 20 }

function americanRow(index: number): Listed {
  return { id: 20_000 + index, region: 'US-E', rating: 2_600 - 100 * index, wins: 20 }
}

const americanBoard = [american, slipped, ...Array.from({ length: 6 }, (_, index) => americanRow(index))]

// SEA was filled by the scan but one row was dropped as a duplicate, so it has a row less than a full scan
const droppedRank = 3
const seaTop: Listed = { id: 501, region: 'SEA', rating: 2_600, wins: 20, sourceRank: 1 }
const seaFaded: Listed = { id: 502, region: 'SEA', rating: 1_000, wins: 20, sourceRank: 2 }

function seaRow(sourceRank: number): Listed {
  return {
    id: 30_000 + sourceRank,
    region: 'SEA',
    rating: 2_500 - 10 * (sourceRank - droppedRank),
    wins: 20,
    sourceRank,
  }
}

const seaBoard = [
  seaTop,
  seaFaded,
  ...Array.from({ length: fullScanRows - droppedRank }, (_, index) => seaRow(droppedRank + index + 1)),
]

const absentId = 999

const latestBoards: Record<Scope, Listed[]> = {
  all: [anna, american, cleo, bram, visitor],
  EU: europeBoard,
  'US-E': americanBoard,
  SEA: seaBoard,
}

const bramOnTop: Listed = { ...bram, rating: 2_900 }

const boardsWithBramOnTop: Partial<Record<Scope, Listed[]>> = {
  all: [bramOnTop, american, anna],
  EU: [bramOnTop, anna],
  'US-E': [american],
}

let database: TestDatabase

function boardRow(snapshotId: string, mode: Mode, listed: Listed, index: number) {
  return {
    snapshot_id: snapshotId,
    mode,
    ordinal: index + 1,
    standing: index + 1,
    source_rank: listed.sourceRank ?? index + 1,
    identity_kind: identityKinds[mode],
    player_one_id: listed.id,
    player_one_name: `Captured ${listed.id}`,
    player_two_id: null,
    player_two_name: null,
    region: listed.region,
    rating: listed.rating,
    peak_rating: 3_000,
    wins: listed.wins,
    losses: 10,
    tier: 'Diamond',
  }
}

async function publishBoard(generationId: string, mode: Mode, scope: Scope, board: Listed[]) {
  const snapshotId = randomUUID()
  const rows = board.map((listed, index) => boardRow(snapshotId, mode, listed, index))
  const sql = database.sql

  await sql`
    INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
    VALUES (${snapshotId}, ${generationId}, ${mode}, ${scope}, ${rows.length})
  `

  await sql`INSERT INTO rankings.snapshot_rows ${sql(rows)}`
}

async function publishGeneration({ mode, windowAt, isFinalized = true, boards }: Generation) {
  const generationId = randomUUID()
  const provenance = { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: scannedPages }
  const nextPublicationAt = new Date(windowAt.getTime() + 15 * 60 * 1000)
  const sql = database.sql

  await sql`
    INSERT INTO rankings.generations
      (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
       expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
    VALUES (${generationId}, ${randomUUID()}, ${`board-ranks-test:${randomUUID()}`}, ${mode}, ${windowAt},
      ${windowAt}, ${nextPublicationAt}, ${scannedPages}, 'brawlhalla-v1-ranked-leaderboard', 2, false,
      ${sql.json(provenance)})
  `

  for (const [scope, board] of Object.entries(boards) as [Scope, Listed[]][]) {
    await publishBoard(generationId, mode, scope, board)
  }

  if (!isFinalized) return

  await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
}

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'board_ranks_procedure',
    modules: [queueModule, playerModule, rankingModule],
  })

  await publishGeneration({ mode: '1v1', windowAt: new Date('2026-11-09T11:30:00.000Z'), boards: boardsWithBramOnTop })
  await publishGeneration({ mode: '1v1', windowAt: new Date('2026-11-09T12:00:00.000Z'), boards: latestBoards })

  // both are newer than the latest published 1v1 boards, and neither may be read
  await publishGeneration({
    mode: 'solo2v2',
    windowAt: new Date('2026-11-09T12:10:00.000Z'),
    boards: boardsWithBramOnTop,
  })

  await publishGeneration({
    mode: '1v1',
    windowAt: new Date('2026-11-09T12:30:00.000Z'),
    isFinalized: false,
    boards: boardsWithBramOnTop,
  })
}, 30_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

function readRanks(input: { id: number; region?: Region }) {
  const { boardRanksById } = createRankingProcedures({ database })

  return call(boardRanksById, input, internalCaller)
}

async function readBoardPage(region: Scope, page: number) {
  const { leaderboardPage } = createRankingProcedures({ database })
  const board = await call(leaderboardPage, { mode: '1v1', region, page }, internalCaller)

  if (board.status === 'unavailable') throw new Error(`Expected the published ${region} board`)

  return board.entries
}

async function readBoard(region: Scope) {
  const pageCount = Math.ceil(latestBoards[region].length / leaderboardPageSize)
  const pages = await Promise.all(Array.from({ length: pageCount }, (_, index) => readBoardPage(region, index + 1)))

  return pages.flat()
}

function playerIdOf(entry: Awaited<ReturnType<typeof readBoardPage>>[number]): number {
  if (entry.identity.type === 'fixed-two-vs-two-team') throw new Error('Expected a 1v1 board')

  return entry.identity.player.brawlhallaId
}

// the players a regional board gives no rank, after checking that every rank it does give is the leaderboard page's
async function unrankedOn(region: Region): Promise<number[]> {
  const entries = await readBoard(region)
  const unranked: number[] = []

  expect(entries).toHaveLength(latestBoards[region].length)

  for (const entry of entries) {
    const { regionRank } = await readRanks({ id: playerIdOf(entry), region })

    if (regionRank === null) unranked.push(playerIdOf(entry))
    else expect(regionRank).toBe(entry.standing)
  }

  return unranked
}

describe('boardRanksById', () => {
  test('places a player by rating on the board of their region and on the global one', async () => {
    expect(await readRanks({ id: anna.id, region: 'EU' })).toEqual({ globalRank: 2, regionRank: 1 })
    expect(await readRanks({ id: american.id, region: 'US-E' })).toEqual({ globalRank: 1, regionRank: 1 })
  })

  test('gives every player it ranks on a full regional board the place the leaderboard page shows', async () => {
    expect(await unrankedOn('EU')).toEqual([faded.id, fallen.id])
  })

  test('has no regional rank for a row rated below the last row brawlhalla lists on a full board', async () => {
    const entries = await readBoard('EU')
    const shownAt = entries.find((entry) => playerIdOf(entry) === faded.id)

    expect(shownAt).toMatchObject({ standing: 49, sourceRank: 5 })

    expect(await readRanks({ id: faded.id, region: 'EU' })).toMatchObject({ regionRank: null })
    expect(await readRanks({ id: fallen.id, region: 'EU' })).toMatchObject({ regionRank: null })
  })

  test('keeps the standing of a row rated exactly as the last row brawlhalla lists', async () => {
    expect(atCutOff.rating).toBe(lastListed.rating)
    expect(await readRanks({ id: atCutOff.id, region: 'EU' })).toMatchObject({ regionRank: 48 })
  })

  test('keeps the standing of the high rated rows in the block brawlhalla lists first', async () => {
    expect(await readRanks({ id: bram.id, region: 'EU' })).toMatchObject({ regionRank: 6 })
    expect(await readRanks({ id: cleo.id, region: 'EU' })).toMatchObject({ regionRank: 27 })
  })

  test('keeps every standing on a board the scan did not fill, which lists its whole region', async () => {
    expect(await unrankedOn('US-E')).toEqual([])
    expect(await readRanks({ id: slipped.id, region: 'US-E' })).toMatchObject({ regionRank: americanBoard.length })
  })

  test('still cuts off a full board that lost a row to a duplicate', async () => {
    expect(seaBoard).toHaveLength(fullScanRows - 1)
    expect(await unrankedOn('SEA')).toEqual([seaFaded.id])
  })

  test('gives every player on the global board the place the leaderboard page shows', async () => {
    const entries = await readBoard('all')

    expect(entries).toHaveLength(latestBoards.all.length)

    for (const entry of entries) {
      const ranks = await readRanks({ id: playerIdOf(entry) })

      expect(ranks.globalRank).toBe(entry.standing)
    }
  })

  test('a rating tie goes to the player with more wins', async () => {
    expect(await readRanks({ id: lastListed.id, region: 'EU' })).toMatchObject({ regionRank: 47 })
    expect(await readRanks({ id: atCutOff.id, region: 'EU' })).toMatchObject({ regionRank: 48 })
  })

  test('has no rank for a player on neither board', async () => {
    expect(await readRanks({ id: absentId, region: 'EU' })).toEqual({ globalRank: null, regionRank: null })
  })

  test('has no regional rank for a player who is only a visitor on another region', async () => {
    expect(await readRanks({ id: visitor.id, region: 'EU' })).toEqual({ globalRank: 4, regionRank: 16 })
    expect(await readRanks({ id: visitor.id, region: 'US-E' })).toEqual({ globalRank: 4, regionRank: null })
  })

  test('has no regional rank when no region is asked for', async () => {
    expect(await readRanks({ id: anna.id })).toEqual({ globalRank: 2, regionRank: null })
  })

  test('reads the latest published 1v1 boards, not an older, unpublished or other bracket one', async () => {
    // every other generation has bram first on both boards
    expect(await readRanks({ id: bram.id, region: 'EU' })).toEqual({ globalRank: 3, regionRank: 6 })
  })

  test('rejects callers from outside', () => {
    const { boardRanksById } = createRankingProcedures({ database })

    expect(call(boardRanksById, { id: anna.id, region: 'EU' }, outsideCaller)).rejects.toThrow()
  })
})

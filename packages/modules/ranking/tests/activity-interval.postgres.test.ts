import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { rankingModule } from '../index'
import { createPostgresRanking } from '../postgres'

type Mode = '1v1' | '3v3'

const minuteMs = 60 * 1000
// what the collector claims, while production scans land about hourly
const claimedScanIntervalMs = 15 * minuteMs

const identityKinds: Record<Mode, string> = {
  '1v1': 'one-vs-one-player',
  '3v3': 'three-vs-three-player',
}

let database: TestDatabase

function at(isoTime: string): Date {
  return new Date(isoTime)
}

function minutesBefore(time: Date, minutes: number): Date {
  return new Date(time.getTime() - minutes * minuteMs)
}

// one player whose wins count the scans, so the wins delta says which scan was compared
async function publishScan(mode: Mode, windowAt: Date, wins: number): Promise<string> {
  const generationId = randomUUID()
  const snapshotId = randomUUID()
  const provenance = { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: 1 }
  const nextPublicationAt = new Date(windowAt.getTime() + claimedScanIntervalMs)
  const sql = database.sql

  await sql`
    INSERT INTO rankings.generations
      (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
       expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
    VALUES (${generationId}, ${randomUUID()}, ${`activity-interval-test:${randomUUID()}`}, ${mode}, ${windowAt},
      ${windowAt}, ${nextPublicationAt}, 1, 'brawlhalla-v1-ranked-leaderboard', 2, false, ${sql.json(provenance)})
  `

  await sql`
    INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
    VALUES (${snapshotId}, ${generationId}, ${mode}, 'EU', 1)
  `

  await sql`
    INSERT INTO rankings.snapshot_rows
      (snapshot_id, mode, ordinal, standing, source_rank, identity_kind, player_one_id, player_one_name,
       player_two_id, player_two_name, region, rating, peak_rating, wins, losses, tier)
    VALUES (${snapshotId}, ${mode}, 1, 1, 1, ${identityKinds[mode]}, 7, 'Scanned', NULL, NULL, 'EU', 2000, 2100,
      ${wins}, 10, 'Diamond')
  `

  await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`

  return snapshotId
}

// scans the same 1v1 board at each time, a win apart, and returns the snapshot of the last one
async function publishScans(times: Date[]): Promise<string> {
  let snapshotId = ''

  for (const [index, time] of times.entries()) {
    snapshotId = await publishScan('1v1', time, index + 1)
  }

  return snapshotId
}

function readActivity(snapshotId: string) {
  const ranking = createPostgresRanking(database)

  return ranking.queries.getRecentActivity({ mode: '1v1', region: 'EU', page: 1, snapshotId })
}

async function comparedInterval(snapshotId: string) {
  const view = await readActivity(snapshotId)

  if (view.status === 'unavailable') throw new Error(`Expected an interval, got ${view.reason}`)

  return { from: view.previousObservedAt, to: view.currentObservedAt, winsDelta: view.entries[0]?.winsDelta }
}

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'activity_interval',
    modules: [queueModule, playerModule, rankingModule],
  })
}, 30_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('the earlier scan of the queue', () => {
  test('compares the hourly, irregular solo 2v2 scans production had', async () => {
    const current = at('2026-01-01T01:37:00Z')

    const snapshotId = await publishScans([
      at('2025-12-31T22:52:00Z'),
      at('2025-12-31T23:52:00Z'),
      at('2026-01-01T00:52:00Z'),
      current,
    ])

    expect(await comparedInterval(snapshotId)).toEqual({
      from: '2026-01-01T00:52:00.000Z',
      to: '2026-01-01T01:37:00.000Z',
      winsDelta: 1,
    })
  })

  test('compares the 2v2 scans production had, 1 h 15 min apart', async () => {
    await publishScan('1v1', at('2026-01-02T23:33:00Z'), 1)
    const snapshotId = await publishScan('1v1', at('2026-01-03T00:48:00Z'), 2)

    expect(await comparedInterval(snapshotId)).toMatchObject({ from: '2026-01-02T23:33:00.000Z', winsDelta: 1 })
  })

  test('skips a scan less than 45 minutes back for the one before it', async () => {
    const current = at('2026-01-05T12:00:00Z')
    const snapshotId = await publishScans([minutesBefore(current, 75), minutesBefore(current, 40), current])

    expect(await comparedInterval(snapshotId)).toMatchObject({ from: '2026-01-05T10:45:00.000Z', winsDelta: 2 })
  })

  test('compares as far back as two hours', async () => {
    const current = at('2026-01-07T12:00:00Z')
    const snapshotId = await publishScans([minutesBefore(current, 120), current])

    expect(await comparedInterval(snapshotId)).toMatchObject({ from: '2026-01-07T10:00:00.000Z' })
  })

  test('calls more than two hours without a scan a gap', async () => {
    const current = at('2026-01-09T12:00:00Z')
    const snapshotId = await publishScans([minutesBefore(current, 180), current])

    expect(await readActivity(snapshotId)).toMatchObject({ status: 'unavailable', reason: 'scan_gap' })
  })

  test('calls a board whose last scan before this one is over six hours old too new to compare', async () => {
    const current = at('2026-01-11T12:00:00Z')
    const snapshotId = await publishScans([minutesBefore(current, 7 * 60), current])

    expect(await readActivity(snapshotId)).toMatchObject({ status: 'unavailable', reason: 'not_enough_history' })
  })

  test('calls a fresh install too new to compare', async () => {
    const current = at('2026-01-13T12:00:00Z')
    const firstSnapshotId = await publishScans([current])

    expect(await readActivity(firstSnapshotId)).toMatchObject({ status: 'unavailable', reason: 'not_enough_history' })

    const secondSnapshotId = await publishScan('1v1', new Date(current.getTime() + 30 * minuteMs), 2)

    expect(await readActivity(secondSnapshotId)).toMatchObject({ status: 'unavailable', reason: 'not_enough_history' })
  })
})

describe('the movers of the queue', () => {
  test('compare the same scans as the page', async () => {
    const ranking = createPostgresRanking(database)
    const current = at('2026-02-01T12:00:00Z')

    await publishScans([minutesBefore(current, 75), minutesBefore(current, 40), current])
    const movers = await ranking.queries.getRecentMovers({ mode: '1v1', region: 'EU' })

    if (movers.status === 'unavailable') throw new Error(`Expected movers, got ${movers.reason}`)

    expect(movers.mostGames.map(({ gamesDelta }) => gamesDelta)).toEqual([2])
  })

  test('say when more than two hours went without a scan', async () => {
    const ranking = createPostgresRanking(database)
    const current = at('2026-02-01T12:00:00Z')

    await publishScan('3v3', minutesBefore(current, 180), 1)
    await publishScan('3v3', current, 2)

    expect(await ranking.queries.getRecentMovers({ mode: '3v3', region: 'EU' })).toMatchObject({
      status: 'unavailable',
      reason: 'scan_gap',
    })
  })
})

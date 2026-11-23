import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { type LeaderboardOperationKind, type OperationLease, queueModule } from '@brawltome/queue'
import {
  collectAndPublishLeaderboardGeneration,
  createPostgresRanking,
  type LeaderboardPageSource,
  LeaderboardSourceError,
  leaderboardCollectionContract,
  type RankingPublicationAuthorization,
  type RegionalLeaderboardScope,
  rankingModule,
  reconcileLeaderboardSchedule,
  regionalLeaderboardScopes,
} from '@brawltome/ranking'
import { requestAdmissionModule } from '@brawltome/request-admission'
import { createTestQueue } from './fixtures/queue'

const minuteMs = 60 * 1000
const intervalMs = 15 * minuteMs

const admission = {
  totalConcurrency: 8,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 4,
    'global-statistics': 1,
    projection: 2,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
} as const

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'ranking_regions',
    modules: [queueModule, requestAdmissionModule, playerModule, rankingModule],
  })
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

type LeaderboardLease = Extract<OperationLease, { kind: LeaderboardOperationKind }>

function authorizationOf(lease: LeaderboardLease, windowAt: Date | null): RankingPublicationAuthorization {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    operationKind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    scheduleWindowAt: windowAt ? windowAt.toISOString() : lease.scheduleWindowAt,
  }
}

function requireLeaderboardLease(lease: OperationLease | null): LeaderboardLease {
  if (lease?.kind !== 'leaderboard-1v1') throw new Error('Expected a 1v1 leaderboard lease')

  return lease
}

async function leaseScan(operations: ReturnType<typeof createTestQueue>, label: string): Promise<LeaderboardLease> {
  await operations.accept({
    job: leaderboardCollectionContract('leaderboard-1v1'),
    dedupeKey: `ranking-regions:${label}:${randomUUID()}`,
    operationKey: `ranking-regions:${label}:${randomUUID()}`,
    workClass: 'leaderboard',
    payload: { pageDepth: 1, intervalMs },
    provenance: { source: 'ranking-regions-test' },
  })

  return requireLeaderboardLease(await operations.claim(`worker:${label}`, 10_000, admission, 'leaderboard-1v1'))
}

function playerIdOf(region: RegionalLeaderboardScope): number {
  return 700_000 + regionalLeaderboardScopes.indexOf(region)
}

// an EU player that brawlhalla lists only on US-E's board
const usEastVisitorId = 799_999

function sourceRow(id: number, region: RegionalLeaderboardScope, rank: number, wins: number) {
  return {
    identity: { type: 'one-vs-one-player' as const, player: { id, username: `Player ${id}` } },
    rating: 2_000 + wins - rank,
    best_rating: 2_100 + wins,
    rank,
    wins,
    losses: 10,
    region,
    tier: 'Diamond',
  }
}

// one player per region, whose wins count the games played up to this scan
function scanSource(
  wins: number,
  failingRegions: readonly RegionalLeaderboardScope[] = [],
  hasUsEastVisitor = false,
): LeaderboardPageSource {
  return {
    async fetchPage({ region }) {
      if (failingRegions.includes(region)) {
        throw new LeaderboardSourceError('source_unavailable', `V1 leaderboard returned 502 for 1v1/${region}`, true)
      }

      const rankings = [sourceRow(playerIdOf(region), region, 1, wins)]

      if (hasUsEastVisitor && region === 'US-E') rankings.push(sourceRow(usEastVisitorId, 'EU', 2, wins))

      return { rankings, totalPages: 1 }
    },
  }
}

// a scheduled scan whose source answers at the window, one game later than the scan before
async function scanWindow(
  windowAt: Date,
  wins: number,
  failingRegions: readonly RegionalLeaderboardScope[] = [],
  hasUsEastVisitor = false,
) {
  const operations = createTestQueue({ database })
  const lease = await leaseScan(operations, `window-${windowAt.toISOString()}`)

  const result = await collectAndPublishLeaderboardGeneration({
    mode: '1v1',
    authorization: authorizationOf(lease, windowAt),
    source: scanSource(wins, failingRegions, hasUsEastVisitor),
    publication: createPostgresRanking(database),
    pageDepth: 1,
    intervalMs,
    clock: () => windowAt,
  })

  await operations.complete(lease)

  return result
}

function playerOf(identity: { type: string; player?: { brawlhallaId: number } }): number {
  return identity.player?.brawlhallaId ?? 0
}

function minutesAfter(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * minuteMs)
}

async function failuresFor(windowAt: Date) {
  const failures = await database.sql<{ scope: string; code: string }[]>`
    SELECT scope, code FROM rankings.collection_failures
    WHERE mode = '1v1' AND schedule_window_at = ${windowAt}
    ORDER BY scope
  `

  return [...failures]
}

describe('leaderboard regions publish apart', () => {
  test('publishes every other region while US-E fails, and keeps US-E on its last good rows', async () => {
    const ranking = createPostgresRanking(database)
    const firstWindow = new Date('2000-01-01T00:00:00.000Z')
    const secondWindow = minutesAfter(firstWindow, 15)
    const now = minutesAfter(secondWindow, 1)

    expect(await scanWindow(firstWindow, 20)).toBe('published')
    expect(await scanWindow(secondWindow, 21, ['US-E'])).toBe('published')

    expect(await failuresFor(secondWindow)).toEqual([{ scope: 'US-E', code: 'source_unavailable' }])

    const europe = await ranking.queries.getLeaderboard({ mode: '1v1', region: 'EU', page: 1, now })

    expect(europe).toMatchObject({ status: 'fresh', observedAt: secondWindow.toISOString() })
    expect(europe.status !== 'unavailable' && europe.entries).toMatchObject([{ wins: 21 }])

    const usEast = await ranking.queries.getLeaderboard({ mode: '1v1', region: 'US-E', page: 1, now })

    expect(usEast).toMatchObject({ status: 'stale', observedAt: firstWindow.toISOString() })
    expect(usEast.status !== 'unavailable' && usEast.entries).toMatchObject([{ wins: 20 }])

    // the global board carries US-E from its last good scan and says it is stale
    const global = await ranking.queries.getLeaderboard({ mode: '1v1', region: 'all', page: 1, now })

    expect(global).toMatchObject({ status: 'stale', observedAt: secondWindow.toISOString(), totalRows: 9 })

    const globalUsEast =
      global.status === 'unavailable'
        ? undefined
        : global.entries.find(
            ({ identity }) =>
              identity.type === 'one-vs-one-player' && identity.player.brawlhallaId === playerIdOf('US-E'),
          )

    expect(globalUsEast).toMatchObject({ wins: 20 })
  })

  test('gives a stale region its own age in the Queue while the others move on', async () => {
    const ranking = createPostgresRanking(database)
    const start = new Date('2000-02-01T00:00:00.000Z')
    const hourLater = minutesAfter(start, 60)
    const usEastFails = minutesAfter(start, 75)
    const usEastStillFails = minutesAfter(start, 90)
    const now = minutesAfter(usEastStillFails, 1)

    await scanWindow(start, 30)
    await scanWindow(hourLater, 32)
    await scanWindow(usEastFails, 33, ['US-E'])
    await scanWindow(usEastStillFails, 34, ['US-E'])

    const europe = await ranking.queries.getRecentActivity({ mode: '1v1', region: 'EU', page: 1, now })

    expect(europe).toMatchObject({
      status: 'fresh',
      previousObservedAt: start.toISOString(),
      currentObservedAt: usEastStillFails.toISOString(),
      entries: [{ gamesDelta: 4, winsDelta: 4 }],
    })

    const usEast = await ranking.queries.getRecentActivity({ mode: '1v1', region: 'US-E', page: 1, now })

    expect(usEast).toMatchObject({
      status: 'stale',
      previousObservedAt: start.toISOString(),
      currentObservedAt: hourLater.toISOString(),
      entries: [{ gamesDelta: 2, winsDelta: 2 }],
    })

    expect(usEast.status !== 'unavailable' && Date.parse(usEast.publishedAt)).toBeLessThan(
      europe.status === 'unavailable' ? 0 : Date.parse(europe.publishedAt),
    )

    const movers = await ranking.queries.getRecentMovers({ mode: '1v1', region: 'US-E' })

    expect(movers).toMatchObject({
      status: 'available',
      currentSnapshotId: usEast.status === 'unavailable' ? '' : usEast.currentSnapshotId,
    })
  })

  test('leaves the players of a carried board out of the global Queue, visitors included', async () => {
    const ranking = createPostgresRanking(database)
    const start = new Date('2000-03-01T00:00:00.000Z')
    const usEastFails = minutesAfter(start, 60)
    const usEastRecovers = minutesAfter(start, 120)

    // every player wins 2 games a scan; the 4 of US-E's board since the start land in one scan when it recovers. that
    // board also lists an EU player, whose own region says nothing about the board their row came from
    await scanWindow(start, 30, [], true)
    await scanWindow(usEastFails, 32, ['US-E'], true)
    await scanWindow(usEastRecovers, 34, [], true)

    const global = await ranking.queries.getRecentActivity({
      mode: '1v1',
      region: 'all',
      page: 1,
      now: minutesAfter(usEastRecovers, 1),
    })

    expect(global).toMatchObject({
      previousObservedAt: usEastFails.toISOString(),
      currentObservedAt: usEastRecovers.toISOString(),
      totalRows: 8,
    })

    const globalIds = global.status === 'unavailable' ? [] : global.entries.map(({ identity }) => playerOf(identity))

    expect(globalIds).not.toContain(playerIdOf('US-E'))
    expect(globalIds).not.toContain(usEastVisitorId)
    expect(global.status !== 'unavailable' && global.entries.every(({ gamesDelta }) => gamesDelta === 2)).toBe(true)

    const movers = await ranking.queries.getRecentMovers({ mode: '1v1', region: 'all' })

    const moverIds = movers.status === 'unavailable' ? [] : movers.mostGames.map(({ identity }) => playerOf(identity))

    expect(moverIds).not.toContain(usEastVisitorId)
  })

  test('keeps the regions a superseded window already published', async () => {
    const operations = createTestQueue({ database })
    const ranking = createPostgresRanking(database)

    const schedule = await reconcileLeaderboardSchedule(database, {
      scheduleKey: `ranking-regions-superseded:${randomUUID()}`,
      operationKeyPrefix: `ranking-regions-superseded:${randomUUID()}`,
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      intervalMs,
      firstDueAt: new Date(Date.now() - 1_000).toISOString(),
      payload: { pageDepth: 1, intervalMs },
      provenance: { source: 'integration-test', requestedBy: 'ranking-regions' },
    })

    await operations.materializeDueSchedules()

    const superseded = requireLeaderboardLease(
      await operations.claim('slow-scan', 10_000, admission, 'leaderboard-1v1'),
    )

    const usual = scanSource(40)

    // the scan reaches EU only after the next window came due and superseded it
    const slowSource: LeaderboardPageSource = {
      async fetchPage(input) {
        if (input.region === 'EU') {
          await database.sql`
            UPDATE queue.schedules SET next_due_at = clock_timestamp() - interval '1 second'
            WHERE id = ${schedule.scheduleId}
          `

          await operations.materializeDueSchedules()
        }

        return usual.fetchPage(input)
      },
    }

    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: '1v1',
        authorization: authorizationOf(superseded, null),
        source: slowSource,
        publication: ranking,
        pageDepth: 1,
        intervalMs,
      }),
    ).rejects.toMatchObject({ code: 'leaderboard_lease_lost' })

    expect((await operations.inspect(superseded.operationId)).operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'superseded_scheduled_operation' },
    })

    const published = await database.sql<{ operation_key: string; scope: string }[]>`
      SELECT generation.operation_key, snapshot.scope
      FROM rankings.generations generation
      JOIN rankings.snapshots snapshot ON snapshot.generation_id = generation.id AND snapshot.mode = generation.mode
      WHERE generation.operation_id = ${superseded.effectOperationId}
      ORDER BY snapshot.scope
    `

    expect([...published]).toEqual([
      { operation_key: `${superseded.operationKey}:US-E`, scope: 'US-E' },
      { operation_key: `${superseded.operationKey}:US-W`, scope: 'US-W' },
    ])

    const usWest = await ranking.queries.getLeaderboard({ mode: '1v1', region: 'US-W', page: 1 })

    expect(usWest.status !== 'unavailable' && usWest.entries).toMatchObject([{ wins: 40 }])

    // the newer window collects every region again, US-E and US-W included
    const next = requireLeaderboardLease(await operations.claim('next-scan', 10_000, admission, 'leaderboard-1v1'))
    const calls: RegionalLeaderboardScope[] = []
    const nextSource = scanSource(41)

    expect(
      await collectAndPublishLeaderboardGeneration({
        mode: '1v1',
        authorization: authorizationOf(next, null),
        source: {
          fetchPage: (input) => {
            calls.push(input.region)

            return nextSource.fetchPage(input)
          },
        },
        publication: ranking,
        pageDepth: 1,
        intervalMs,
      }),
    ).toBe('published')

    expect(calls).toEqual([...regionalLeaderboardScopes])
    expect(await operations.complete(next)).toBe('transitioned')
  })
})

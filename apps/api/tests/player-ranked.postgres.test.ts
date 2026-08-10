import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  createPostgresRankedPlayers,
  playerMigrationInventory,
  refreshCanonicalRankedPlayer,
} from '@brawltome/player/composition'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  type PostgresRefreshOperations,
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_ranked_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

const snapshot = {
  name: 'Canonical Player',
  brawlhalla_id: 91913839,
  rating: 0,
  peak_rating: 782,
  tier: 'Tin 0',
  wins: 0,
  games: 0,
  region: 'US-E',
  global_rank: 0,
  region_rank: 0,
  legends: [],
  '2v2': [
    {
      brawlhalla_id_one: 91913839,
      brawlhalla_id_two: 0,
      rating: 1670,
      peak_rating: 1670,
      tier: 'Gold 5',
      wins: 2,
      games: 2,
      teamname: 'Solo Queue',
      region: 3,
      global_rank: 0,
    },
  ],
}

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Players ranked integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of [...playerMigrationInventory, ...refreshOperationsMigrationInventory]) {
      await setup.unsafe(migration.sql)
    }
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

const admission = {
  totalConcurrency: 2,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 1,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
} as const

async function claimRankedOperation(operations: PostgresRefreshOperations, brawlhallaId: number) {
  const reserved = await operations.reserveInteractivePlayerRefresh({
    dedupeKey: `ranked:${randomUUID()}`,
    operationKey: `ranked:${randomUUID()}`,
    brawlhallaId,
    staleSections: ['ranked'],
    provenance: { source: 'integration-test' },
    reservationTtlSeconds: 30,
  })
  if (reserved.outcome !== 'reserved') throw new Error('Expected a reserved operation')
  await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
  const lease = await operations.claim('ranked-test-worker', 10_000, admission)
  if (!lease || lease.kind !== 'interactive-player-refresh') throw new Error('Expected an interactive lease')
  return lease
}

async function expireLease(operationId: string) {
  const control = postgres(connectionString, { max: 1 })
  try {
    await control`
      UPDATE refresh_operations.operations
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${operationId}
    `
  } finally {
    await control.end()
  }
}

function effectFor(lease: Extract<OperationLease, { kind: 'interactive-player-refresh' }>) {
  return {
    operationId: lease.operationId,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    section: 'ranked' as const,
  }
}

const source = (payload: unknown) => ({
  getRanked: async (_id: number, options: { onAttempt(): void }) => {
    options.onAttempt()
    return payload
  },
})

describe('Players-owned canonical ranked state', () => {
  test('persists measured zero and keeps Solo Queue separate through a fenced interactive operation', async () => {
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const lease = await claimRankedOperation(operations, 91913839)
      expect(await operations.beginInteractiveSection(lease, 'ranked')).toBe('execute')

      await refreshCanonicalRankedPlayer(players, source(snapshot), 91913839, { caller: 'on-demand' }, effectFor(lease))
      expect(await operations.commitInteractiveSection(lease, 'ranked')).toBe('transitioned')
      expect(await operations.complete(lease)).toBe('transitioned')

      expect(await players.referenceById(91913839)).toEqual({
        brawlhallaId: 91913839,
        name: 'Canonical Player',
      })
      const profile = await players.byId(91913839)
      expect(profile?.snapshot).toMatchObject({
        oneVsOne: { rating: 0, games: 0, globalRank: null },
        rankedLegends: [],
        fixedTeams: [],
        soloQueue: [{ rating: 1670, games: 2, region: 'EU' }],
        ratingHistory: [],
      })
      expect(profile?.checkedAt).toBeInstanceOf(Date)
      expect(profile?.lastSuccessAt).toEqual(profile?.checkedAt)
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('reconciles a crash after the atomic ranked effect without dead-lettering or reapplying', async () => {
    const brawlhallaId = 91913841
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const lease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source({ ...snapshot, brawlhalla_id: brawlhallaId, '2v2': [] }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(lease),
      )
      expect(await operations.beginInteractiveSection(lease, 'ranked')).toBe('already-applied')

      await expireLease(lease.operationId)
      expect(await operations.claim('recovery-worker', 10_000, admission)).toBeNull()
      expect((await operations.inspect(lease.operationId)).operation.status).toBe('succeeded')
      expect(await players.referenceById(brawlhallaId)).toEqual({ brawlhallaId, name: 'Canonical Player' })
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('preserves last success on malformed attempts, then authoritatively applies empty arrays on retry', async () => {
    const brawlhallaId = 91913840
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    const populated = {
      ...snapshot,
      brawlhalla_id: brawlhallaId,
      name: 'History Player',
      rating: 1600,
      peak_rating: 1650,
      tier: 'Gold 4',
      wins: 5,
      games: 10,
      legends: [
        {
          legend_id: 3,
          legend_name_key: 'bodvar',
          rating: 1600,
          peak_rating: 1650,
          tier: 'Gold 4',
          wins: 5,
          games: 10,
        },
      ],
      '2v2': [
        {
          brawlhalla_id_one: brawlhallaId,
          brawlhalla_id_two: 42,
          rating: 1500,
          peak_rating: 1510,
          tier: 'Gold 1',
          wins: 4,
          games: 9,
          teamname: 'History Player + Partner',
          region: 2,
          global_rank: 0,
        },
      ],
    }
    try {
      const firstLease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source(populated),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(firstLease),
      )
      await operations.commitInteractiveSection(firstLease, 'ranked')
      await operations.complete(firstLease)
      const first = await players.byId(brawlhallaId)
      if (!first?.lastSuccessAt) throw new Error('Expected an initial success')

      await Bun.sleep(5)
      const retryLease = await claimRankedOperation(operations, brawlhallaId)
      await expect(
        refreshCanonicalRankedPlayer(
          players,
          source({ ...populated, legends: undefined }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(retryLease),
        ),
      ).rejects.toThrow('ranked.legends must be an array')

      const afterFailure = await players.byId(brawlhallaId)
      expect(afterFailure?.lastSuccessAt).toEqual(first.lastSuccessAt)
      expect(afterFailure?.checkedAt.getTime()).toBeGreaterThan(first.checkedAt.getTime())
      expect(afterFailure?.snapshot?.rankedLegends).toHaveLength(1)
      expect(await operations.beginInteractiveSection(retryLease, 'ranked')).toBe('execute')

      await refreshCanonicalRankedPlayer(
        players,
        source({
          ...populated,
          rating: 1601,
          games: 11,
          legends: [],
          '2v2': [],
        }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(retryLease),
      )
      await operations.commitInteractiveSection(retryLease, 'ranked')
      await operations.complete(retryLease)

      const applied = await players.byId(brawlhallaId)
      expect(applied?.snapshot).toMatchObject({
        rankedLegends: [],
        fixedTeams: [],
        soloQueue: [],
        ratingHistory: [
          { rating: 1601, games: 11 },
          { rating: 1600, games: 10 },
        ],
      })
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('rejects canonical writes from an expired ranked lease', async () => {
    const brawlhallaId = 91913842
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const reserved = await operations.reserveInteractivePlayerRefresh({
        dedupeKey: `ranked:${randomUUID()}`,
        operationKey: `ranked:${randomUUID()}`,
        brawlhallaId,
        staleSections: ['ranked'],
        provenance: { source: 'integration-test' },
        reservationTtlSeconds: 30,
      })
      if (reserved.outcome !== 'reserved') throw new Error('Expected a reserved operation')
      await operations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)
      const lease = await operations.claim('expired-ranked-worker', 10_000, admission)
      if (!lease || lease.kind !== 'interactive-player-refresh') throw new Error('Expected an interactive lease')
      await expireLease(lease.operationId)

      await expect(
        refreshCanonicalRankedPlayer(
          players,
          source({ ...snapshot, brawlhalla_id: brawlhallaId, '2v2': [] }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(lease),
        ),
      ).rejects.toThrow('lease lost')
      expect(await players.byId(brawlhallaId)).toBeNull()
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })
})

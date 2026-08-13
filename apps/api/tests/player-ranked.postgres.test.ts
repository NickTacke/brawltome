import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  createPostgresRankedPlayers,
  playerMigrationInventory,
  refreshCanonicalRankedPlayer,
  refreshRankedPlayerPulse,
} from '@brawltome/player/composition'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  type PostgresRefreshOperations,
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

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
  totalConcurrency: 3,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 2,
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
  const lease = await operations.claim('ranked-test-worker', 10_000, admission, 'interactive-player-refresh')
  if (!lease || lease.kind !== 'interactive-player-refresh') throw new Error('Expected an interactive lease')
  return lease
}

async function claimPulseOperation(operations: PostgresRefreshOperations, brawlhallaId: number) {
  const accepted = await operations.accept({
    kind: 'ranked-player-pulse',
    dedupeKey: `ranked-pulse:${randomUUID()}`,
    operationKey: `ranked-pulse:${randomUUID()}`,
    workClass: 'primary-monitoring',
    payload: { brawlhallaId },
    provenance: { source: 'integration-test' },
  })
  const lease = await operations.claim(`ranked-pulse-worker:${randomUUID()}`, 10_000, admission, 'ranked-player-pulse')
  if (!lease || lease.kind !== 'ranked-player-pulse' || lease.operationId !== accepted.operationId) {
    throw new Error('Expected a ranked pulse lease')
  }
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

function effectFor(lease: OperationLease) {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    effectCreatedAt: lease.effectCreatedAt,
    section: 'ranked' as const,
  }
}

const source = (payload: unknown) => ({
  getRanked: async (_id: number, options: { onAttempt(): void }) => {
    options.onAttempt()
    return payload
  },
})

const pulseSource = (oneVsOne: unknown, fixedTeams: unknown = null) => ({
  getOneVsOne: async (_id: number, options: { onAttempt(): void }) => {
    options.onAttempt()
    return oneVsOne
  },
  getFixedTeams: async (_id: number, options: { onAttempt(): void }) => {
    options.onAttempt()
    return fixedTeams
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
        bestLegendNameKey: null,
        legacyRating: null,
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

  test('preserves an imported identity when V0 ranked omits the player name', async () => {
    const brawlhallaId = 91913843
    const control = postgres(connectionString, { max: 1 })
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      await control`
        INSERT INTO players.legacy_discovery_profiles
          (brawlhalla_id, player_name, view_count, observed_at, archive_checksum)
        VALUES (${brawlhallaId}, 'Imported Identity', 0, clock_timestamp(), ${'a'.repeat(64)})
      `
      const lease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source({ ...snapshot, brawlhalla_id: brawlhallaId, name: '', '2v2': [] }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(lease),
      )
      expect(await players.referenceById(brawlhallaId)).toMatchObject({ name: 'Imported Identity' })
    } finally {
      await Promise.all([control.end(), players.close(), operations.close()])
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
      expect(await players.referenceById(brawlhallaId)).toEqual({
        brawlhallaId,
        name: 'Canonical Player',
        bestLegendNameKey: null,
        legacyRating: null,
      })
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
        observedRatingDirection: {
          direction: 'up',
          ratingChange: 1,
          observationCount: 2,
          fromObservedAt: expect.any(Date),
          toObservedAt: expect.any(Date),
        },
      })
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('runs a durable Primary-monitoring pulse through the worker and Players read seam', async () => {
    const brawlhallaId = 91913848
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const canonicalLease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source({ ...snapshot, brawlhalla_id: brawlhallaId, rating: 1500, games: 10, '2v2': [] }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(canonicalLease),
      )
      await operations.commitInteractiveSection(canonicalLease, 'ranked')
      await operations.complete(canonicalLease)

      const accepted = await operations.accept({
        kind: 'ranked-player-pulse',
        dedupeKey: `ranked-pulse:${brawlhallaId}`,
        operationKey: `ranked-pulse:${brawlhallaId}:${randomUUID()}`,
        workClass: 'primary-monitoring',
        payload: { brawlhallaId },
        provenance: { source: 'integration-test' },
      })
      expect(
        await runOneRefreshOperation(operations, 'ranked-pulse-worker', {
          leaseMs: 10_000,
          retryDelayMs: 1,
          admission,
          sourceAdmission: {
            admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
            pauseSource: async () => {},
          },
          executeRankedPulse: async (lease) => {
            await refreshRankedPlayerPulse(
              players,
              pulseSource({ brawlhalla_id: brawlhallaId, rating: 1750, games: 14 }),
              brawlhallaId,
              { caller: 'background' },
              effectFor(lease),
            )
          },
        }),
      ).toBe(true)
      expect((await operations.inspect(accepted.operationId)).operation.status).toBe('succeeded')
      expect(await players.byId(brawlhallaId)).toMatchObject({
        lastSuccessAt: expect.any(Date),
        sparsePulse: {
          checkedAt: expect.any(Date),
          lastSuccessAt: expect.any(Date),
        },
        snapshot: {
          oneVsOne: { rating: 1750, games: 14 },
          ratingHistory: [{ rating: 1500, games: 10 }],
          observedRatingDirection: null,
        },
      })
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('applies sparse V1 overlays without changing canonical fields, composition, Solo Queue, or V0 history', async () => {
    const brawlhallaId = 91913843
    const partnerId = 42
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const canonicalLease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source({
          ...snapshot,
          brawlhalla_id: brawlhallaId,
          name: 'Pulse Player',
          rating: 1600,
          peak_rating: 1650,
          tier: 'Gold 4',
          wins: 5,
          games: 10,
          global_rank: 900,
          region_rank: 90,
          legends: [
            {
              legend_id: 3,
              legend_name_key: 'bodvar',
              rating: 1590,
              peak_rating: 1640,
              tier: 'Gold 4',
              wins: 4,
              games: 9,
            },
          ],
          '2v2': [
            {
              brawlhalla_id_one: brawlhallaId,
              brawlhalla_id_two: partnerId,
              rating: 1500,
              peak_rating: 1510,
              tier: 'Gold 1',
              wins: 4,
              games: 9,
              teamname: 'Canonical Team',
              region: 2,
              global_rank: 77,
            },
            {
              brawlhalla_id_one: brawlhallaId,
              brawlhalla_id_two: 43,
              rating: 1450,
              peak_rating: 1490,
              tier: 'Silver 5',
              wins: 3,
              games: 8,
              teamname: 'Omitted Canonical Team',
              region: 3,
              global_rank: 88,
            },
            {
              ...snapshot['2v2'][0],
              brawlhalla_id_one: brawlhallaId,
            },
          ],
        }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(canonicalLease),
      )
      await operations.commitInteractiveSection(canonicalLease, 'ranked')
      await operations.complete(canonicalLease)
      const canonical = await players.byId(brawlhallaId)
      if (!canonical?.lastSuccessAt) throw new Error('Expected canonical ranked state')

      const pulseLease = await claimPulseOperation(operations, brawlhallaId)
      expect(
        await refreshRankedPlayerPulse(
          players,
          pulseSource(
            {
              brawlhalla_id: brawlhallaId,
              rating: 1700,
              peak_rating: 1725,
              wins: 8,
              games: 14,
              tier: 'Diamond',
              region: 'EU',
              global_rank: 1,
              region_rank: 1,
              losses: 6,
              avatar: 99,
              legends: [],
            },
            {
              brawlhalla_id: brawlhallaId,
              teams: {
                ranked_2v2: [
                  {
                    brawlhalla_id_one: partnerId,
                    brawlhalla_id_two: brawlhallaId,
                    rating: 1555,
                    peak_rating: 1580,
                    wins: 7,
                    games: 13,
                    tier: 'Diamond',
                    region: 'EU',
                    username_one: 'Changed',
                    username_two: 'Composition',
                    losses: 6,
                  },
                  {
                    brawlhalla_id_one: brawlhallaId,
                    brawlhalla_id_two: 777,
                    rating: 2000,
                  },
                  {
                    brawlhalla_id_one: brawlhallaId,
                    brawlhalla_id_two: 0,
                    rating: 2000,
                  },
                ],
              },
            },
          ),
          brawlhallaId,
          { caller: 'background' },
          effectFor(pulseLease),
        ),
      ).toBe('applied')
      await operations.complete(pulseLease)

      const updated = await players.byId(brawlhallaId)
      expect(updated?.lastSuccessAt).toEqual(canonical.lastSuccessAt)
      expect(updated?.snapshot).toMatchObject({
        oneVsOne: {
          rating: 1700,
          peakRating: 1725,
          wins: 8,
          games: 14,
          tier: 'Gold 4',
          region: 'US-E',
          globalRank: 900,
          regionRank: 90,
        },
        rankedLegends: [{ legendId: 3, tier: 'Gold 4', games: 9 }],
        fixedTeams: [
          {
            brawlhallaIdOne: brawlhallaId,
            brawlhallaIdTwo: partnerId,
            teamName: 'Canonical Team',
            rating: 1555,
            peakRating: 1580,
            wins: 7,
            games: 13,
            tier: 'Gold 1',
            region: 'US-E',
            globalRank: 77,
          },
          {
            brawlhallaIdOne: brawlhallaId,
            brawlhallaIdTwo: 43,
            teamName: 'Omitted Canonical Team',
            rating: 1450,
            peakRating: 1490,
            wins: 3,
            games: 8,
            tier: 'Silver 5',
            region: 'EU',
            globalRank: 88,
          },
        ],
        soloQueue: [{ rating: 1670, games: 2, region: 'EU' }],
        ratingHistory: [{ rating: 1600, games: 10, tier: 'Gold 4' }],
      })
      const pulseStatus = await players.pulseStatusById(brawlhallaId)
      expect(pulseStatus).toMatchObject({
        checkedAt: expect.any(Date),
        lastSuccessAt: expect.any(Date),
      })

      const stalePulseLease = await claimPulseOperation(operations, brawlhallaId)
      await Bun.sleep(2)
      const newerCanonicalLease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source({
          ...snapshot,
          brawlhalla_id: brawlhallaId,
          name: 'Pulse Player',
          rating: 1800,
          peak_rating: 1820,
          tier: 'Platinum 1',
          wins: 9,
          games: 15,
          legends: [],
          '2v2': [
            {
              brawlhalla_id_one: brawlhallaId,
              brawlhalla_id_two: partnerId,
              rating: 1600,
              peak_rating: 1610,
              tier: 'Platinum 1',
              wins: 8,
              games: 14,
              teamname: 'Canonical Team',
              region: 2,
              global_rank: 70,
            },
          ],
        }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(newerCanonicalLease),
      )
      await operations.commitInteractiveSection(newerCanonicalLease, 'ranked')
      await operations.complete(newerCanonicalLease)
      expect(await players.byId(brawlhallaId)).toMatchObject({
        snapshot: {
          oneVsOne: { rating: 1800, peakRating: 1820, tier: 'Platinum 1', wins: 9, games: 15 },
          fixedTeams: [{ rating: 1600, peakRating: 1610, wins: 8, games: 14, tier: 'Platinum 1' }],
          ratingHistory: [
            { rating: 1800, games: 15, tier: 'Platinum 1' },
            { rating: 1600, games: 10, tier: 'Gold 4' },
          ],
        },
      })
      expect(await players.pulseStatusById(brawlhallaId)).toEqual(pulseStatus)
      expect(
        await refreshRankedPlayerPulse(
          players,
          pulseSource({ brawlhalla_id: brawlhallaId, rating: 999, games: 99 }),
          brawlhallaId,
          { caller: 'background' },
          effectFor(stalePulseLease),
        ),
      ).toBe('stale')
      expect(await players.pulseStatusById(brawlhallaId)).toEqual(pulseStatus)
      await operations.complete(stalePulseLease)

      await Bun.sleep(2)
      const sparsePulseLease = await claimPulseOperation(operations, brawlhallaId)
      expect(
        await refreshRankedPlayerPulse(
          players,
          pulseSource(
            { brawlhalla_id: brawlhallaId, rating: 1850 },
            {
              brawlhalla_id: brawlhallaId,
              teams: {
                ranked_2v2: [{ brawlhalla_id_one: brawlhallaId, brawlhalla_id_two: partnerId, rating: 1650 }],
              },
            },
          ),
          brawlhallaId,
          { caller: 'background' },
          effectFor(sparsePulseLease),
        ),
      ).toBe('applied')
      expect(await players.byId(brawlhallaId)).toMatchObject({
        snapshot: {
          oneVsOne: { rating: 1850, peakRating: 1820, wins: 9, games: 15 },
          fixedTeams: [{ rating: 1650, peakRating: 1610, wins: 8, games: 14 }],
        },
      })
      await operations.complete(sparsePulseLease)
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('keeps empty and failed V1 attempts as no-ops without advancing pulse last-success', async () => {
    const brawlhallaId = 91913844
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const canonicalLease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source({ ...snapshot, brawlhalla_id: brawlhallaId, '2v2': [] }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(canonicalLease),
      )
      await operations.commitInteractiveSection(canonicalLease, 'ranked')
      await operations.complete(canonicalLease)
      const canonical = await players.byId(brawlhallaId)

      const attempts: Array<unknown | Error> = [
        null,
        new Error('timeout'),
        new Error('429'),
        { brawlhalla_id: brawlhallaId, tier: 'Gold' },
        { brawlhalla_id: brawlhallaId, rating: 'malformed' },
      ]
      for (const attempt of attempts) {
        const lease = await claimPulseOperation(operations, brawlhallaId)
        const run = refreshRankedPlayerPulse(
          players,
          attempt instanceof Error
            ? {
                getOneVsOne: async (_id: number, options: { onAttempt(): void }) => {
                  options.onAttempt()
                  throw attempt
                },
                getFixedTeams: async () => null,
              }
            : pulseSource(attempt),
          brawlhallaId,
          { caller: 'background' },
          effectFor(lease),
        )
        expect(await run).toBe('no-op')
        await operations.complete(lease)
      }

      const admissionLease = await claimPulseOperation(operations, brawlhallaId)
      await expect(
        refreshRankedPlayerPulse(
          players,
          {
            getOneVsOne: async () => {
              throw new Error('source admission blocked')
            },
            getFixedTeams: async () => null,
          },
          brawlhallaId,
          { caller: 'background' },
          effectFor(admissionLease),
        ),
      ).rejects.toThrow('source admission blocked')
      await operations.fail(
        admissionLease,
        { code: 'expected_admission_failure', message: 'expected', retryable: false },
        0,
      )

      const crashLease = await claimPulseOperation(operations, brawlhallaId)
      expect(
        await refreshRankedPlayerPulse(
          players,
          pulseSource(null),
          brawlhallaId,
          { caller: 'background' },
          effectFor(crashLease),
        ),
      ).toBe('no-op')
      await expireLease(crashLease.operationId)
      expect(await operations.claim('ranked-noop-recovery', 10_000, admission)).toBeNull()
      expect((await operations.inspect(crashLease.operationId)).operation.status).toBe('succeeded')

      expect(await players.byId(brawlhallaId)).toMatchObject({
        ...canonical,
        sparsePulse: { checkedAt: expect.any(Date), lastSuccessAt: null },
      })
      expect(await players.pulseStatusById(brawlhallaId)).toMatchObject({
        checkedAt: expect.any(Date),
        lastSuccessAt: null,
      })
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('applies delayed team evidence independently when a newer pulse omitted that canonical team', async () => {
    const brawlhallaId = 91913846
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString, { executionConcurrency: 3 })
    try {
      const canonicalLease = await claimRankedOperation(operations, brawlhallaId)
      const canonicalTeams = [
        {
          brawlhalla_id_one: brawlhallaId,
          brawlhalla_id_two: 42,
          rating: 1400,
          peak_rating: 1450,
          tier: 'Silver 4',
          wins: 3,
          games: 8,
          teamname: 'Team A',
          region: 2,
          global_rank: 0,
        },
        {
          brawlhalla_id_one: brawlhallaId,
          brawlhalla_id_two: 43,
          rating: 1410,
          peak_rating: 1460,
          tier: 'Silver 4',
          wins: 4,
          games: 9,
          teamname: 'Team B',
          region: 2,
          global_rank: 0,
        },
      ]
      await refreshCanonicalRankedPlayer(
        players,
        source({ ...snapshot, brawlhalla_id: brawlhallaId, rating: 1500, games: 10, '2v2': canonicalTeams }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(canonicalLease),
      )
      await operations.commitInteractiveSection(canonicalLease, 'ranked')
      await operations.complete(canonicalLease)

      const older = await claimPulseOperation(operations, brawlhallaId)
      await Bun.sleep(2)
      const newer = await claimPulseOperation(operations, brawlhallaId)
      let releaseOlder!: () => void
      let markOlderStarted!: () => void
      const olderStarted = new Promise<void>((resolve) => {
        markOlderStarted = resolve
      })
      const olderBlocked = new Promise<void>((resolve) => {
        releaseOlder = resolve
      })
      const olderRun = refreshRankedPlayerPulse(
        players,
        {
          getOneVsOne: async (_id: number, options: { onAttempt(): void }) => {
            options.onAttempt()
            return null
          },
          getFixedTeams: async (_id: number, options: { onAttempt(): void }) => {
            options.onAttempt()
            markOlderStarted()
            await olderBlocked
            return {
              brawlhalla_id: brawlhallaId,
              teams: { ranked_2v2: [{ brawlhalla_id_one: brawlhallaId, brawlhalla_id_two: 43, rating: 1510 }] },
            }
          },
        },
        brawlhallaId,
        { caller: 'background' },
        effectFor(older),
      )
      await olderStarted
      expect(
        await refreshRankedPlayerPulse(
          players,
          pulseSource(
            { brawlhalla_id: brawlhallaId, rating: 1700 },
            {
              brawlhalla_id: brawlhallaId,
              teams: { ranked_2v2: [{ brawlhalla_id_one: brawlhallaId, brawlhalla_id_two: 42, rating: 1500 }] },
            },
          ),
          brawlhallaId,
          { caller: 'background' },
          effectFor(newer),
        ),
      ).toBe('applied')
      releaseOlder()
      expect(await olderRun).toBe('applied')
      expect(await players.byId(brawlhallaId)).toMatchObject({
        snapshot: {
          oneVsOne: { rating: 1700 },
          fixedTeams: [
            { brawlhallaIdTwo: 42, rating: 1500 },
            { brawlhallaIdTwo: 43, rating: 1510 },
          ],
        },
      })
      for (const lease of [older, newer]) await operations.complete(lease)
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('rejects stale pulse completion and preserves ordering across replay and repository restart', async () => {
    const brawlhallaId = 91913845
    let players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString, { executionConcurrency: 3 })
    try {
      const canonicalLease = await claimRankedOperation(operations, brawlhallaId)
      await refreshCanonicalRankedPlayer(
        players,
        source({ ...snapshot, brawlhalla_id: brawlhallaId, rating: 1500, games: 10, '2v2': [] }),
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(canonicalLease),
      )
      await operations.commitInteractiveSection(canonicalLease, 'ranked')
      await operations.complete(canonicalLease)

      const older = await claimPulseOperation(operations, brawlhallaId)
      await Bun.sleep(2)
      const newer = await claimPulseOperation(operations, brawlhallaId)

      let releaseOlder!: () => void
      let markOlderStarted!: () => void
      const olderStarted = new Promise<void>((resolve) => {
        markOlderStarted = resolve
      })
      const olderBlocked = new Promise<void>((resolve) => {
        releaseOlder = resolve
      })
      const olderRun = refreshRankedPlayerPulse(
        players,
        {
          getOneVsOne: async (_id: number, options: { onAttempt(): void }) => {
            options.onAttempt()
            markOlderStarted()
            await olderBlocked
            return { brawlhalla_id: brawlhallaId, rating: 1600, games: 11 }
          },
          getFixedTeams: async () => null,
        },
        brawlhallaId,
        { caller: 'background' },
        effectFor(older),
      )
      await olderStarted
      expect(
        await refreshRankedPlayerPulse(
          players,
          pulseSource({ brawlhalla_id: brawlhallaId, rating: 1700, games: 12 }),
          brawlhallaId,
          { caller: 'background' },
          effectFor(newer),
        ),
      ).toBe('applied')
      releaseOlder()
      expect(await olderRun).toBe('stale')
      expect(
        await refreshRankedPlayerPulse(
          players,
          pulseSource({ brawlhalla_id: brawlhallaId, rating: 999, games: 99 }),
          brawlhallaId,
          { caller: 'background' },
          effectFor(newer),
        ),
      ).toBe('already-applied')
      await operations.complete(older)
      await operations.complete(newer)

      await players.close()
      players = createPostgresRankedPlayers(connectionString)
      expect(await players.byId(brawlhallaId)).toMatchObject({
        snapshot: { oneVsOne: { rating: 1700, games: 12 }, ratingHistory: [{ rating: 1500, games: 10 }] },
      })
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })

  test('rejects delayed older V0 completion without rewriting canonical state or history', async () => {
    const brawlhallaId = 91913847
    const players = createPostgresRankedPlayers(connectionString)
    const operations = createPostgresRefreshOperations(connectionString, { executionConcurrency: 3 })
    try {
      const older = await claimPulseOperation(operations, brawlhallaId)
      await Bun.sleep(2)
      const newer = await claimPulseOperation(operations, brawlhallaId)
      let releaseOlder!: () => void
      let markOlderStarted!: () => void
      const olderStarted = new Promise<void>((resolve) => {
        markOlderStarted = resolve
      })
      const olderBlocked = new Promise<void>((resolve) => {
        releaseOlder = resolve
      })
      const olderRun = refreshCanonicalRankedPlayer(
        players,
        {
          getRanked: async (_id: number, options: { onAttempt(): void }) => {
            options.onAttempt()
            markOlderStarted()
            await olderBlocked
            return {
              ...snapshot,
              brawlhalla_id: brawlhallaId,
              name: 'Stale V0',
              rating: 1500,
              games: 10,
              '2v2': [],
            }
          },
        },
        brawlhallaId,
        { caller: 'on-demand' },
        effectFor(older),
      )
      await olderStarted
      expect(
        await refreshCanonicalRankedPlayer(
          players,
          source({
            ...snapshot,
            brawlhalla_id: brawlhallaId,
            name: 'Newer V0',
            rating: 1700,
            games: 12,
            '2v2': [],
          }),
          brawlhallaId,
          { caller: 'on-demand' },
          effectFor(newer),
        ),
      ).toBe('applied')
      releaseOlder()
      expect(await olderRun).toBe('stale')
      expect(await players.byId(brawlhallaId)).toMatchObject({
        snapshot: { oneVsOne: { rating: 1700, games: 12 }, ratingHistory: [{ rating: 1700, games: 12 }] },
      })
      for (const lease of [older, newer]) await operations.complete(lease)
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
      await expect(
        refreshRankedPlayerPulse(
          players,
          pulseSource({ brawlhalla_id: brawlhallaId, rating: 1700 }),
          brawlhallaId,
          { caller: 'background' },
          effectFor(lease),
        ),
      ).rejects.toThrow('lease lost')
      expect(await players.byId(brawlhallaId)).toBeNull()
    } finally {
      await Promise.all([players.close(), operations.close()])
    }
  })
})

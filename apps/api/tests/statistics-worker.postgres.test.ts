import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type TestDatabase, createTestDatabase, openTestClient } from '@brawltome/foundation/testing'
import {
  type AdmissionConfig,
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  refreshOperationsModule,
} from '@brawltome/refresh-operations'
import { createPostgresRequestAdmission, requestAdmissionModule } from '@brawltome/request-admission'
import { createPostgresStatistics, statisticsModule } from '@brawltome/statistics'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'
import { reconcileStatisticsCohort } from '../src/statistics-cohort-reconciliation'
import { collectStatisticsEvidence } from '../src/statistics-collection-source'

let database: TestDatabase
let connectionString = ''

const admission: AdmissionConfig = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
}

beforeAll(async () => {
  const configuredUrl = new URL(process.env.DATABASE_URL ?? 'postgres://unset')

  if (configuredUrl.hostname !== '127.0.0.1' || configuredUrl.port !== '55436') {
    throw new Error('Statistics tests require dedicated PostgreSQL 127.0.0.1:55436')
  }

  database = await createTestDatabase({
    label: 'statistics_worker',
    modules: [refreshOperationsModule, requestAdmissionModule, statisticsModule],
  })

  connectionString = database.connectionString
})

afterAll(async () => {
  await database?.drop()
})

const rankedEvidence = (id: number) => ({
  brawlhalla_id: id,
  name: 'Tracer',
  games: 20,
  wins: 12,
  rating: 2100,
  peak_rating: 2200,
  region: 'EU',
  region_ranks: [],
  legends: [{ legend_id: 3, games: 10, wins: 6, rating: 2050, peak_rating: 2150, tier: 'Diamond' }],
})

const lifetimeEvidence = (id: number) => ({
  brawlhalla_id: id,
  name: 'Tracer',
  games: 100,
  wins: 60,
  damage_bomb: 0,
  damage_mine: 0,
  damage_spikeball: 0,
  damage_sidekick: 0,
  hit_snowball: 0,
  ko_bomb: 0,
  ko_mine: 0,
  ko_sidekick: 0,
  ko_snowball: 0,
  ko_spikeball: 0,
  region_ranks: [],
  legends: [
    {
      legend_id: 3,
      games: 50,
      wins: 30,
      damage_dealt: 1000,
      damage_taken: 900,
      kos: 40,
      falls: 35,
      suicides: 1,
      team_kos: 0,
      match_time: 3000,
      damage_unarmed: 10,
      damage_thrown_item: 5,
      damage_weapon_one: 400,
      damage_weapon_two: 300,
      damage_gadgets: 20,
      ko_unarmed: 1,
      ko_weapon_one: 15,
      ko_weapon_two: 12,
      ko_gadgets: 1,
      time_held_weapon_one: 1200,
      time_held_weapon_two: 1500,
    },
  ],
})

describe('Statistics durable production worker', () => {
  test('admits each V1 attempt, survives restart, and never calls team or guild endpoints', async () => {
    // each simulated worker process has its own client, closed and reopened at every restart
    let workerClient = openTestClient(database.connectionString)
    let operations = createPostgresRefreshOperations({ database: workerClient })
    let statistics = createPostgresStatistics(workerClient)

    const sourceAdmission = createPostgresRequestAdmission(database, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 10, 'brawlhalla-v1': 10 },
    })

    async function restart(): Promise<void> {
      await workerClient.close()
      workerClient = openTestClient(database.connectionString)
      operations = createPostgresRefreshOperations({ database: workerClient })
      statistics = createPostgresStatistics(workerClient)
    }

    const calls: string[] = []
    let forbiddenCalls = 0
    let lifetimeAttempts = 0

    const source = {
      async getPlayerStatsV1Payload(id: number, mode: 'ranked_1v1' | 'all') {
        calls.push(`${id}:${mode}`)
        if (mode === 'ranked_1v1') return rankedEvidence(id)

        lifetimeAttempts++

        return lifetimeAttempts === 1 ? { ...lifetimeEvidence(id), brawlhalla_id: id + 1 } : lifetimeEvidence(id)
      },
      async getPlayerTeamsV1() {
        forbiddenCalls++
        throw new Error('team endpoint must not be called')
      },
      async getPlayerGuildV1() {
        forbiddenCalls++
        throw new Error('guild endpoint must not be called')
      },
      async getGuildStatsV1() {
        forbiddenCalls++
        throw new Error('guild endpoint must not be called')
      },
      async getGuildMembersV1() {
        forbiddenCalls++
        throw new Error('guild endpoint must not be called')
      },
    }

    const cohort = await statistics.reconcileCohort({
      snapshotId: '00000000-0000-4000-8000-000000000001',
      generationId: '10000000-0000-4000-8000-000000000001',
      observedAt: '2026-08-10T00:00:00.000Z',
      region: 'EU',
      mode: '1v1',
      candidates: [{ brawlhallaId: 42, rating: 2000 }],
    })

    const intents = await statistics.collectionIntents()
    const rankedIntent = intents.find((intent) => intent.product === 'ranked')
    const lifetimeIntent = intents.find((intent) => intent.product === 'lifetime')

    if (!rankedIntent || !lifetimeIntent) throw new Error('Statistics collection intents missing')

    const reserve = (intent: typeof rankedIntent) =>
      operations.reserveStatisticsCollection({
        kind: intent.kind,
        dedupeKey: intent.operationKey,
        operationKey: intent.operationKey,
        workClass: 'global-statistics',
        payload: { cohortId: intent.cohortId, brawlhallaId: intent.brawlhallaId },
        provenance: { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' },
        maxAttempts: 3,
      })

    await reserve(rankedIntent)
    const lifetime = await reserve(lifetimeIntent)

    await statistics.recordCollectionOperation(lifetimeIntent, lifetime.operationId)
    expect(await operations.claim('worker-before-binding', 1_000, admission)).toBeNull()

    await restart()

    await reconcileStatisticsCohort(statistics, operations, {
      getLeaderboard: async (input) => ({
        status: 'unavailable',
        reason: 'not_yet_published',
        mode: input.mode,
        page: input.page,
        pageSize: input.pageSize ?? 50,
      }),
    })

    const options = () => ({
      leaseMs: 1_000,
      retryDelayMs: 0,
      admission,
      sourceAdmission,
      statistics,
      executeStatisticsCollection: (lease: Parameters<typeof collectStatisticsEvidence>[1]) =>
        collectStatisticsEvidence(source, lease),
    })

    expect(await runOneRefreshOperation(operations, 'worker-before-restart', options())).toBe(true)
    expect(await runOneRefreshOperation(operations, 'worker-before-restart', options())).toBe(true)

    await restart()
    expect(await runOneRefreshOperation(operations, 'worker-after-restart', options())).toBe(true)

    const audit = await statistics.getCohort()

    expect(audit?.cohortId).toBe(cohort.cohortId)

    expect(audit?.members[0]).toMatchObject({
      brawlhallaId: 42,
      rankedSucceededAt: expect.any(String),
      lifetimeSucceededAt: expect.any(String),
    })

    expect(calls).toEqual(['42:ranked_1v1', '42:all', '42:all'])
    expect(forbiddenCalls).toBe(0)

    const sql = postgres(connectionString, { max: 1 })

    try {
      const attempts = await sql<{ kind: string; attempt_count: number; status: string }[]>`
        SELECT kind, attempt_count, status FROM refresh_operations.operations
        WHERE kind IN ('statistics-ranked-collection', 'statistics-lifetime-collection')
        ORDER BY kind
      `

      expect(attempts.map(({ kind, attempt_count, status }) => ({ kind, attempt_count, status }))).toEqual([
        { kind: 'statistics-lifetime-collection', attempt_count: 2, status: 'succeeded' },
        { kind: 'statistics-ranked-collection', attempt_count: 1, status: 'succeeded' },
      ])

      const [reservations] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM request_admission.source_reservations
        WHERE domain = 'brawlhalla-v1'
      `

      expect(reservations.count).toBe('3')

      const [rankedOperation] = await sql<{ id: string }[]>`
        UPDATE refresh_operations.operations
        SET status = 'dead_letter', completed_at = clock_timestamp()
        WHERE kind = 'statistics-ranked-collection'
        RETURNING id
      `

      const deadLetters = createPostgresDeadLetterOperations(database)

      const replay = await deadLetters.replayDeadLetter({
        operationId: rankedOperation.id,
        actorId: 'operator:statistics-recovery',
        reason: 'verify committed observation replay recovery',
      })

      expect(replay.outcome).toBe('replayed')

      let replaySourceCalls = 0

      expect(
        await runOneRefreshOperation(operations, 'replay-worker', {
          ...options(),
          executeStatisticsCollection: async () => {
            replaySourceCalls++
            throw new Error('source drift must not be read for an already-applied observation')
          },
        }),
      ).toBe(true)

      expect(replaySourceCalls).toBe(0)

      const [replayOperation] = await sql<{ status: string }[]>`
        SELECT status FROM refresh_operations.operations
        WHERE replayed_from_operation_id = ${rankedOperation.id}
      `

      expect(replayOperation.status).toBe('succeeded')

      const [reservationsAfterReplay] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM request_admission.source_reservations
        WHERE domain = 'brawlhalla-v1'
      `

      expect(reservationsAfterReplay.count).toBe('3')

      const [sourceAttempts] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM statistics.collection_attempts
      `

      expect(sourceAttempts.count).toBe('3')
    } finally {
      await sql.end()
    }

    await workerClient.close()
  })
})

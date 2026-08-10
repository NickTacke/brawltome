import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { AdmissionConfig } from '@brawltome/refresh-operations'
import {
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import {
  createPostgresRequestAdmission,
  requestAdmissionMigrationInventory,
} from '@brawltome/request-admission/composition'
import { createPostgresStatistics, statisticsMigrationInventory } from '@brawltome/statistics/composition'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'
import { reconcileStatisticsCohort } from '../src/statistics-cohort-reconciliation'
import { collectStatisticsEvidence } from '../src/statistics-collection-source'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_statistics_worker_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
let admin: ReturnType<typeof postgres>
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
  if (!baseUrl) throw new Error('DATABASE_URL is required')
  const adminUrl = new URL(baseUrl)
  if (adminUrl.hostname !== '127.0.0.1' || adminUrl.port !== '55436') {
    throw new Error('Statistics tests require dedicated PostgreSQL 127.0.0.1:55436')
  }
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of [
      ...refreshOperationsMigrationInventory,
      ...requestAdmissionMigrationInventory,
      ...statisticsMigrationInventory,
    ]) {
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

const rankedEvidence = (id: number) => ({
  brawlhalla_id: id,
  name: 'Tracer',
  games: 20,
  wins: 12,
  rating: 2100,
  peak_rating: 2200,
  tier: 'Diamond',
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
    let operations = createPostgresRefreshOperations(connectionString)
    let statistics = createPostgresStatistics(connectionString)
    const sourceAdmission = createPostgresRequestAdmission(connectionString, {
      authenticatedIpLimit: 120,
      sourceLimits: { 'brawlhalla-v0': 10, 'brawlhalla-v1': 10 },
    })
    const calls: string[] = []
    let forbiddenCalls = 0
    let lifetimeAttempts = 0
    const source = {
      async getPlayerStatsV1(id: number, mode: 'ranked_1v1' | 'all') {
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
    try {
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

      await operations.close()
      await statistics.close()
      operations = createPostgresRefreshOperations(connectionString)
      statistics = createPostgresStatistics(connectionString)
      await reconcileStatisticsCohort(statistics, operations, {
        getLeaderboard: async () => {
          throw new Error('existing cohort reconciliation must not read a newer Ranking generation')
        },
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

      await operations.close()
      await statistics.close()
      operations = createPostgresRefreshOperations(connectionString)
      statistics = createPostgresStatistics(connectionString)
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
        const deadLetters = createPostgresDeadLetterOperations(connectionString)
        try {
          const replay = await deadLetters.replayDeadLetter({
            operationId: rankedOperation.id,
            actorId: 'operator:statistics-recovery',
            reason: 'verify committed observation replay recovery',
          })
          expect(replay.outcome).toBe('replayed')
        } finally {
          await deadLetters.close()
        }

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
      } finally {
        await sql.end()
      }
    } finally {
      await operations.close()
      await statistics.close()
      await sourceAdmission.close()
    }
  })
})

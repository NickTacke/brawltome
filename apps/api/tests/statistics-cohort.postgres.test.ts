import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { AdmissionConfig, OperationLease } from '@brawltome/refresh-operations'
import {
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import { type CohortCandidateSnapshot, type CohortCollectionIntent, launchCohortRegions } from '@brawltome/statistics'
import { createPostgresStatistics, statisticsMigrationInventory } from '@brawltome/statistics/composition'
import postgres from 'postgres'

const baseUrl = process.env.DATABASE_URL
let databaseName = ''
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

beforeEach(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Statistics PostgreSQL tests')
  databaseName = `brawltome_statistics_${process.pid}_${randomUUID().replaceAll('-', '')}`
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
    for (const migration of [...refreshOperationsMigrationInventory, ...statisticsMigrationInventory]) {
      await setup.unsafe(migration.sql)
    }
  } finally {
    await setup.end()
  }
})

afterEach(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

function snapshot(seed: number, count = 3): CohortCandidateSnapshot {
  return {
    snapshotId: `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`,
    generationId: `10000000-0000-4000-8000-${String(seed).padStart(12, '0')}`,
    observedAt: new Date(Date.UTC(2026, 7, 10, 0, 0, seed)).toISOString(),
    region: 'EU',
    mode: '1v1',
    candidates: Array.from({ length: count }, (_, index) => ({
      brawlhallaId: seed * 10_000 + index + 1,
      rating: 2000 + index,
    })),
  }
}

function fullSnapshots(seed: number): CohortCandidateSnapshot[] {
  return launchCohortRegions.map((region, regionIndex) => ({
    snapshotId: `20000000-0000-4000-8000-${String(seed * 100 + regionIndex + 1).padStart(12, '0')}`,
    generationId: `30000000-0000-4000-8000-${String(seed).padStart(12, '0')}`,
    observedAt: '2026-08-10T00:00:00.000Z',
    region,
    mode: '1v1',
    candidates: [
      { brawlhallaId: seed * 1_000_000 + regionIndex * 10 + 1, rating: 1680 },
      { brawlhallaId: seed * 1_000_000 + regionIndex * 10 + 2, rating: 2000 },
    ],
  }))
}

async function enqueue(
  statistics: ReturnType<typeof createPostgresStatistics>,
  operations: ReturnType<typeof createPostgresRefreshOperations>,
  intent: CohortCollectionIntent,
  maxAttempts = 2,
) {
  const accepted = await operations.reserveStatisticsCollection({
    kind: intent.kind,
    dedupeKey: intent.operationKey,
    operationKey: intent.operationKey,
    workClass: 'global-statistics',
    payload: { cohortId: intent.cohortId, brawlhallaId: intent.brawlhallaId },
    provenance: { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' },
    maxAttempts,
  })
  await statistics.recordCollectionOperation(intent, accepted.operationId)
  await operations.activateStatisticsCollection(accepted.operationId)
  return accepted.operationId
}

const rankedEvidence = (brawlhallaId: number) => ({
  brawlhallaId,
  games: 0,
  wins: 0,
  rating: 2000,
  peakRating: 2000,
  tier: 'Diamond',
  region: 'EU',
  legends: [],
})

const lifetimeEvidence = (brawlhallaId: number) => ({
  brawlhallaId,
  games: 0,
  wins: 0,
  combat: {
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
  },
  legends: [],
})

function authorization(
  lease: Extract<OperationLease, { kind: 'statistics-ranked-collection' | 'statistics-lifetime-collection' }>,
) {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    kind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    cohortId: lease.payload.cohortId,
    brawlhallaId: lease.payload.brawlhallaId,
  }
}

describe('Statistics EU Diamond+ production tracer', () => {
  test('rejects known-insufficient full cells without creating source collection intents', async () => {
    const statistics = createPostgresStatistics(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const generation = await statistics.reconcileLaunchCohort(fullSnapshots(1))
      expect(generation.state).toBe('insufficient-evidence')
      expect(generation.cells).toHaveLength(18)
      expect(await statistics.collectionIntents()).toEqual([])
      const publicationIntents = await statistics.publicationIntents()
      expect(publicationIntents).toEqual([
        expect.objectContaining({ generationId: generation.generationId, product: 'ranked' }),
        expect.objectContaining({ generationId: generation.generationId, product: 'lifetime' }),
      ])
      const intent = publicationIntents[0]
      const reserved = await operations.reserveStatisticsPublication({
        kind: intent.kind,
        dedupeKey: intent.operationKey,
        operationKey: intent.operationKey,
        workClass: 'global-statistics',
        payload: { generationId: intent.generationId, product: intent.product },
        provenance: { source: 'statistics-publication-validation', requestedBy: 'issue-210' },
        maxAttempts: 3,
      })
      expect(await statistics.recordPublicationOperation(intent, reserved.operationId)).toBe('recorded')
      expect(await operations.activateStatisticsPublication(reserved.operationId)).toBe('transitioned')
      const publication = await operations.claim('insufficient-publication', 1_000, admission, 'statistics-publication')
      if (!publication || publication.kind !== 'statistics-publication') throw new Error('publication lease missing')
      const rejected = await statistics.validateAndPublish({
        operationId: publication.operationId,
        effectOperationId: publication.effectOperationId,
        operationKey: publication.operationKey,
        kind: publication.kind,
        leaseOwner: publication.leaseOwner,
        leaseToken: publication.leaseToken,
        generationId: publication.payload.generationId,
        product: publication.payload.product,
      })
      expect(rejected.decision?.outcome).toBe('rejected')
      expect(rejected.decision?.reasons).toContainEqual(expect.objectContaining({ code: 'cell-minimum-not-met' }))
    } finally {
      await statistics.close()
      await operations.close()
    }
  })

  test('concurrent reconciliation pins one immutable generation and restart keeps it after newer input', async () => {
    const first = createPostgresStatistics(connectionString)
    const second = createPostgresStatistics(connectionString)
    try {
      const [left, right] = await Promise.all([first.reconcileCohort(snapshot(1)), second.reconcileCohort(snapshot(2))])
      expect(right).toEqual(left)
      expect(left.members).toHaveLength(3)

      await first.close()
      const restarted = createPostgresStatistics(connectionString)
      try {
        const afterRestart = await restarted.reconcileCohort(snapshot(3))
        expect(afterRestart).toEqual(left)
        expect(afterRestart.sourceSnapshotId).not.toBe(snapshot(3).snapshotId)
      } finally {
        await restarted.close()
      }
    } finally {
      await second.close()
    }
  }, 15_000)

  test('repairs missing cross-owner enqueue with exactly two stable independent operations per member', async () => {
    const statistics = createPostgresStatistics(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      await statistics.reconcileCohort(snapshot(10))
      const intents = await statistics.collectionIntents()
      expect(intents).toHaveLength(6)
      await Promise.all(intents.map((intent) => enqueue(statistics, operations, intent)))
      expect(await statistics.collectionIntents()).toEqual([])

      const firstIntent = intents[0]
      const repeated = await operations.reserveStatisticsCollection({
        kind: firstIntent.kind,
        dedupeKey: firstIntent.operationKey,
        operationKey: firstIntent.operationKey,
        workClass: 'global-statistics',
        payload: { cohortId: firstIntent.cohortId, brawlhallaId: firstIntent.brawlhallaId },
        provenance: { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' },
        maxAttempts: 2,
      })
      const audit = await statistics.getCohort()
      const member = audit?.members.find(({ brawlhallaId }) => brawlhallaId === firstIntent.brawlhallaId)
      if (!member) throw new Error('reconciled member missing')
      const recordedOperationId =
        firstIntent.product === 'ranked' ? member.rankedOperationId : member.lifetimeOperationId
      if (!recordedOperationId) throw new Error('reconciled operation reference missing')
      expect(repeated.operationId).toBe(recordedOperationId)
      await expect(
        operations.reserveStatisticsCollection({
          kind: firstIntent.kind,
          dedupeKey: firstIntent.operationKey,
          operationKey: firstIntent.operationKey,
          workClass: 'global-statistics',
          payload: { cohortId: firstIntent.cohortId, brawlhallaId: firstIntent.brawlhallaId + 1 },
          provenance: { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' },
          maxAttempts: 2,
        }),
      ).rejects.toThrow('different definition')
    } finally {
      await statistics.close()
      await operations.close()
    }
  })

  test('prevents truncating immutable cohort and observation ledgers', async () => {
    const statistics = createPostgresStatistics(connectionString)
    try {
      await statistics.reconcileCohort(snapshot(15, 1))
      for (const table of ['observations', 'collection_operations', 'cohort_members', 'cohorts']) {
        const mutation = Bun.spawn(
          ['psql', connectionString, '-v', 'ON_ERROR_STOP=1', '-c', `TRUNCATE statistics.${table} CASCADE`],
          { stdout: 'pipe', stderr: 'pipe' },
        )
        const [exitCode, stderr] = await Promise.all([
          mutation.exited,
          new Response(mutation.stderr).text(),
          new Response(mutation.stdout).text(),
        ])
        expect(exitCode).not.toBe(0)
        expect(stderr).toContain('statistics cohort evidence is immutable')
      }
    } finally {
      await statistics.close()
    }
  }, 20_000)

  test('tracks ranked success independently while lifetime exhausts bounded retries', async () => {
    const statistics = createPostgresStatistics(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      await statistics.reconcileCohort(snapshot(20, 1))
      await Promise.all((await statistics.collectionIntents()).map((intent) => enqueue(statistics, operations, intent)))
      const ranked = await operations.claim('ranked-worker', 1_000, admission, 'statistics-ranked-collection')
      expect(ranked?.kind).toBe('statistics-ranked-collection')
      if (!ranked || ranked.kind !== 'statistics-ranked-collection') throw new Error('ranked lease missing')
      await expect(
        statistics.commitObservation({
          authorization: { ...authorization(ranked), kind: ranked.kind },
          evidence: { legends: [] } as never,
        }),
      ).rejects.toThrow('brawlhallaId')
      expect(
        await statistics.commitObservation({
          authorization: { ...authorization(ranked), kind: ranked.kind },
          evidence: rankedEvidence(ranked.payload.brawlhallaId),
        }),
      ).toBe('applied')
      expect(await operations.complete(ranked)).toBe('transitioned')

      const lifetime = await operations.claim('lifetime-worker', 1_000, admission, 'statistics-lifetime-collection')
      if (!lifetime || lifetime.kind !== 'statistics-lifetime-collection') throw new Error('lifetime lease missing')
      const retryControl = postgres(connectionString, { max: 1 })
      await retryControl`
        UPDATE refresh_operations.operations SET available_at = 'infinity'
        WHERE kind = 'statistics-lifetime-collection' AND id <> ${lifetime.operationId} AND status = 'pending'
      `
      await operations.fail(lifetime, { code: 'source_failed', message: 'temporary', retryable: true }, 0)
      const retry = await operations.claim('lifetime-worker', 1_000, admission, 'statistics-lifetime-collection')
      if (!retry || retry.kind !== 'statistics-lifetime-collection') throw new Error('lifetime retry missing')
      expect(retry.operationId).toBe(lifetime.operationId)
      await operations.fail(retry, { code: 'source_failed', message: 'still broken', retryable: true }, 0)
      await retryControl`
        UPDATE refresh_operations.operations SET available_at = clock_timestamp()
        WHERE kind = 'statistics-lifetime-collection' AND available_at = 'infinity'
      `
      await retryControl.end()

      const after = await statistics.getCohort()
      const observed = after?.members.find(({ brawlhallaId }) => brawlhallaId === ranked.payload.brawlhallaId)
      expect(observed?.rankedSucceededAt).not.toBeNull()
      expect(observed?.lifetimeSucceededAt).toBeNull()

      const sql = postgres(connectionString, { max: 1 })
      try {
        const [failed] = await sql<{ status: string; attempt_count: number }[]>`
          SELECT status, attempt_count FROM refresh_operations.operations WHERE id = ${retry.operationId}
        `
        expect(failed).toEqual({ status: 'dead_letter', attempt_count: 2 })
      } finally {
        await sql.end()
      }
    } finally {
      await statistics.close()
      await operations.close()
    }
  })

  test('does not spend execution attempts on admission deferral and caps replay-inclusive source attempts at three', async () => {
    const statistics = createPostgresStatistics(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      await statistics.reconcileCohort(snapshot(23, 1))
      const rankedIntent = (await statistics.collectionIntents()).find(({ product }) => product === 'ranked')
      if (!rankedIntent) throw new Error('ranked intent missing')
      const operationId = await enqueue(statistics, operations, rankedIntent, 3)

      const denied = await operations.claim('admission-denied', 1_000, admission, 'statistics-ranked-collection')
      if (!denied || denied.kind !== 'statistics-ranked-collection') throw new Error('denied lease missing')
      expect(denied.attemptNumber).toBe(1)
      expect(
        await operations.defer(
          denied,
          { code: 'source_rate_limited', message: 'deferred for capacity', retryable: true },
          0,
        ),
      ).toBe('transitioned')

      for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber++) {
        const lease = await operations.claim('source-worker', 1_000, admission, 'statistics-ranked-collection')
        if (!lease || lease.kind !== 'statistics-ranked-collection') throw new Error('source lease missing')
        expect(lease.attemptNumber).toBe(attemptNumber)
        expect(
          await statistics.recordCollectionAttempt({
            ...authorization(lease),
            attemptNumber: lease.attemptNumber,
          }),
        ).toBe('recorded')
        expect(
          await operations.fail(
            lease,
            { code: 'source_failed', message: 'retryable source failure', retryable: true },
            0,
          ),
        ).toBe('transitioned')
      }

      const deadLetters = createPostgresDeadLetterOperations(connectionString)
      try {
        const replay = await deadLetters.replayDeadLetter({
          operationId,
          actorId: 'operator:capacity-test',
          reason: 'verify replay-inclusive source cap',
        })
        if (replay.outcome !== 'replayed') throw new Error('Statistics replay missing')
      } finally {
        await deadLetters.close()
      }
      const replayLease = await operations.claim('replay-worker', 1_000, admission, 'statistics-ranked-collection')
      if (!replayLease || replayLease.kind !== 'statistics-ranked-collection') throw new Error('replay lease missing')
      expect(
        await statistics.preflightCollectionAttempt({
          ...authorization(replayLease),
          attemptNumber: replayLease.attemptNumber,
        }),
      ).toBe('capacity-exceeded')

      const sql = postgres(connectionString, { max: 1 })
      try {
        const [attempts] = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM statistics.collection_attempts
          WHERE cohort_id = ${replayLease.payload.cohortId}
            AND brawlhalla_id = ${replayLease.payload.brawlhallaId} AND product = 'ranked'
        `
        expect(attempts.count).toBe('3')
      } finally {
        await sql.end()
      }
    } finally {
      await statistics.close()
      await operations.close()
    }
  })

  test('acknowledges an already-applied observation by durable identity when current evidence changes or drifts', async () => {
    const statistics = createPostgresStatistics(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      await statistics.reconcileCohort(snapshot(25, 1))
      await Promise.all((await statistics.collectionIntents()).map((intent) => enqueue(statistics, operations, intent)))
      const lease = await operations.claim('replay-worker', 1_000, admission, 'statistics-ranked-collection')
      if (!lease || lease.kind !== 'statistics-ranked-collection') throw new Error('ranked lease missing')
      const durableAuthorization = { ...authorization(lease), kind: lease.kind }
      expect(
        await statistics.commitObservation({
          authorization: durableAuthorization,
          evidence: rankedEvidence(lease.payload.brawlhallaId),
        }),
      ).toBe('applied')
      expect(
        await statistics.commitObservation({
          authorization: durableAuthorization,
          evidence: { ...rankedEvidence(lease.payload.brawlhallaId), rating: 2200, peakRating: 2300 },
        }),
      ).toBe('already-applied')
      expect(
        await statistics.commitObservation({
          authorization: durableAuthorization,
          evidence: { current: 'source contract drifted after the durable effect' } as never,
        }),
      ).toBe('already-applied')

      const sql = postgres(connectionString, { max: 1 })
      try {
        const [stored] = await sql<{ count: string; rating: number }[]>`
          SELECT count(*)::text AS count, max((evidence->>'rating')::integer) AS rating
          FROM statistics.observations
          WHERE effect_operation_id = ${lease.effectOperationId}
        `
        expect(stored).toEqual({ count: '1', rating: 2000 })
      } finally {
        await sql.end()
      }
      expect(await operations.complete(lease)).toBe('transitioned')
    } finally {
      await statistics.close()
      await operations.close()
    }
  })

  test('rejects an expired owner, accepts the superseding lease, and bounds concurrent global Statistics claims', async () => {
    const statistics = createPostgresStatistics(connectionString)
    const first = createPostgresRefreshOperations(connectionString)
    const second = createPostgresRefreshOperations(connectionString)
    try {
      await statistics.reconcileCohort(snapshot(30, 1))
      await Promise.all((await statistics.collectionIntents()).map((intent) => enqueue(statistics, first, intent)))
      const expired = await first.claim('expired-worker', 20, admission, 'statistics-lifetime-collection')
      if (!expired || expired.kind !== 'statistics-lifetime-collection') throw new Error('expiring lease missing')
      await Bun.sleep(35)
      const replacement = await second.claim('replacement-worker', 1_000, admission, 'statistics-lifetime-collection')
      if (!replacement || replacement.kind !== 'statistics-lifetime-collection')
        throw new Error('replacement lease missing')
      expect(
        await statistics.commitObservation({
          authorization: { ...authorization(expired), kind: expired.kind },
          evidence: lifetimeEvidence(expired.payload.brawlhallaId),
        }),
      ).toBe('lease-lost')
      expect(
        await statistics.commitObservation({
          authorization: { ...authorization(replacement), kind: replacement.kind },
          evidence: lifetimeEvidence(replacement.payload.brawlhallaId),
        }),
      ).toBe('applied')

      const blocked = await first.claim('concurrent-worker', 1_000, admission)
      expect(blocked).toBeNull()
      await second.complete(replacement)
    } finally {
      await statistics.close()
      await first.close()
      await second.close()
    }
  })

  test('recovers a committed final-attempt effect after worker crash without duplicating evidence', async () => {
    const statistics = createPostgresStatistics(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      await statistics.reconcileCohort(snapshot(40, 1))
      await Promise.all(
        (await statistics.collectionIntents()).map((intent) => enqueue(statistics, operations, intent, 1)),
      )
      const setup = postgres(connectionString, { max: 1 })
      const [finalAttempt] = await setup<{ id: string }[]>`
        WITH selected AS (
          SELECT id FROM refresh_operations.operations
          WHERE kind = 'statistics-ranked-collection' AND status = 'pending'
          ORDER BY created_at, id LIMIT 1
        )
        UPDATE refresh_operations.operations operation
        SET max_attempts = 1
        FROM selected
        WHERE operation.id = selected.id
        RETURNING operation.id
      `
      await setup`
        UPDATE refresh_operations.operations SET available_at = 'infinity'
        WHERE kind = 'statistics-ranked-collection' AND id <> ${finalAttempt.id} AND status = 'pending'
      `
      await setup.end()
      const lease = await operations.claim('crashing-worker', 5_000, admission, 'statistics-ranked-collection')
      if (!lease || lease.kind !== 'statistics-ranked-collection') throw new Error('crash lease missing')
      expect(lease.operationId).toBe(finalAttempt.id)
      expect(
        await statistics.commitObservation({
          authorization: { ...authorization(lease), kind: lease.kind },
          evidence: rankedEvidence(lease.payload.brawlhallaId),
        }),
      ).toBe('applied')
      const expire = postgres(connectionString, { max: 1 })
      await expire`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${lease.operationId}
      `
      await expire.end()
      expect(await operations.claim('restart-worker', 1_000, admission, 'statistics-ranked-collection')).toBeNull()

      const sql = postgres(connectionString, { max: 1 })
      try {
        const [operation] = await sql<{ status: string; attempt_count: number }[]>`
          SELECT status, attempt_count FROM refresh_operations.operations WHERE id = ${lease.operationId}
        `
        const [count] = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM statistics.observations
          WHERE effect_operation_id = ${lease.effectOperationId}
        `
        expect(operation).toEqual({ status: 'succeeded', attempt_count: 1 })
        expect(count.count).toBe('1')
      } finally {
        await sql.end()
      }
    } finally {
      await statistics.close()
      await operations.close()
    }
  })
})

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { AdmissionConfig } from '@brawltome/refresh-operations'
import {
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import { type CohortCandidateSnapshot, type LaunchCohortAudit, launchCohortRegions } from '@brawltome/statistics'
import { createPostgresStatistics, statisticsMigrationInventory } from '@brawltome/statistics/composition'
import postgres from 'postgres'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_statistics_210_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
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
    throw new Error('Statistics #210 tests require dedicated PostgreSQL 127.0.0.1:55436')
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

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

function snapshots(generation: number): CohortCandidateSnapshot[] {
  return launchCohortRegions.map((region, regionIndex) => {
    const base = generation * 10_000_000 + regionIndex * 100_000
    return {
      snapshotId: `00000000-0000-4000-8000-${String(generation * 100 + regionIndex + 1).padStart(12, '0')}`,
      generationId: `10000000-0000-4000-8000-${String(generation).padStart(12, '0')}`,
      observedAt: generation === 1 ? '2026-08-10T00:00:00.000Z' : '2026-08-18T00:00:00.000Z',
      region,
      mode: '1v1',
      candidates: [
        ...Array.from({ length: 125 }, (_, index) => ({ brawlhallaId: base + index + 1, rating: 1680 + index })),
        ...Array.from({ length: 125 }, (_, index) => ({
          brawlhallaId: base + 125 + index + 1,
          rating: 2000 + index,
        })),
      ],
    }
  })
}

async function seedTerminalProduct(
  generation: LaunchCohortAudit,
  product: 'ranked' | 'lifetime',
  successesPerCell: number,
) {
  const sql = postgres(connectionString, { max: 1 })
  const kind = product === 'ranked' ? 'statistics-ranked-collection' : 'statistics-lifetime-collection'
  try {
    await sql`
      WITH candidates AS (
        SELECT cohort.id AS cohort_id, member.brawlhalla_id, member.ordinal,
               gen_random_uuid() AS operation_id,
               'statistics:' || cohort.id::text || ':' || member.brawlhalla_id::text || ':' || ${product} AS operation_key,
               generation.observation_window_starts_at
        FROM statistics.cohorts cohort
        JOIN statistics.cohort_generations generation ON generation.id = cohort.generation_id
        JOIN statistics.cohort_members member ON member.cohort_id = cohort.id
        WHERE cohort.generation_id = ${generation.generationId}
      )
      INSERT INTO refresh_operations.operations
        (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
         status, attempt_count, max_attempts, lease_token, completed_at, created_at, updated_at)
      SELECT operation_id, operation_id, ${kind}, operation_key, operation_key, 'global-statistics',
             jsonb_build_object('cohortId', cohort_id::text, 'brawlhallaId', brawlhalla_id),
             jsonb_build_object('source', 'statistics-cohort-reconciliation', 'requestedBy', 'issue-210'),
             CASE WHEN ordinal <= ${successesPerCell} THEN 'succeeded' ELSE 'dead_letter' END,
             1, 3, 1, observation_window_starts_at + interval '2 hours',
             observation_window_starts_at + interval '1 hour', observation_window_starts_at + interval '2 hours'
      FROM candidates
    `
    await sql`
      INSERT INTO statistics.collection_operations (cohort_id, brawlhalla_id, product, operation_id)
      SELECT cohort.id, member.brawlhalla_id, ${product}, operation.id
      FROM statistics.cohorts cohort
      JOIN statistics.cohort_members member ON member.cohort_id = cohort.id
      JOIN refresh_operations.operations operation
        ON operation.operation_key = 'statistics:' || cohort.id::text || ':' || member.brawlhalla_id::text || ':' || ${product}
      WHERE cohort.generation_id = ${generation.generationId}
    `
    await sql`
      INSERT INTO statistics.collection_attempts
        (cohort_id, brawlhalla_id, product, operation_id, effect_operation_id,
         attempt_number, lease_token, attempted_at)
      SELECT collection.cohort_id, collection.brawlhalla_id, collection.product,
             operation.id, operation.effect_operation_id, 1, 1,
             generation.observation_window_starts_at + interval '1 hour'
      FROM statistics.collection_operations collection
      JOIN statistics.cohorts cohort ON cohort.id = collection.cohort_id
      JOIN statistics.cohort_generations generation ON generation.id = cohort.generation_id
      JOIN refresh_operations.operations operation ON operation.id = collection.operation_id
      WHERE cohort.generation_id = ${generation.generationId} AND collection.product = ${product}
    `
    await sql`
      INSERT INTO statistics.observations
        (cohort_id, brawlhalla_id, product, effect_operation_id, operation_key,
         lease_token, observed_at, evidence_version, evidence)
      SELECT collection.cohort_id, collection.brawlhalla_id, collection.product,
             operation.effect_operation_id, operation.operation_key, 1,
             generation.observation_window_starts_at + interval '2 hours', 1, '{}'::jsonb
      FROM statistics.collection_operations collection
      JOIN statistics.cohorts cohort ON cohort.id = collection.cohort_id
      JOIN statistics.cohort_members member
        ON member.cohort_id = collection.cohort_id AND member.brawlhalla_id = collection.brawlhalla_id
      JOIN statistics.cohort_generations generation ON generation.id = cohort.generation_id
      JOIN refresh_operations.operations operation ON operation.id = collection.operation_id
      WHERE cohort.generation_id = ${generation.generationId} AND collection.product = ${product}
        AND member.ordinal <= ${successesPerCell}
    `
  } finally {
    await sql.end()
  }
}

async function expectPostgresRejection(action: () => Promise<void>, message: string): Promise<void> {
  let failure: unknown
  try {
    await action()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message.toLowerCase()).toContain(message.toLowerCase())
}

async function bindPublication(
  statistics: ReturnType<typeof createPostgresStatistics>,
  operations: ReturnType<typeof createPostgresRefreshOperations>,
  generationId: string,
  product: 'ranked' | 'lifetime',
) {
  const intent = (await statistics.publicationIntents()).find(
    (candidate) => candidate.generationId === generationId && candidate.product === product,
  )
  if (!intent) throw new Error(`missing ${product} publication intent`)
  const reserved = await operations.reserveStatisticsPublication({
    kind: intent.kind,
    dedupeKey: intent.operationKey,
    operationKey: intent.operationKey,
    workClass: 'global-statistics',
    payload: { generationId, product },
    provenance: { source: 'statistics-publication-validation', requestedBy: 'issue-210' },
    maxAttempts: 3,
  })
  expect(await statistics.recordPublicationOperation(intent, reserved.operationId)).toBe('recorded')
  expect(await operations.activateStatisticsPublication(reserved.operationId)).toBe('transitioned')
  return reserved.operationId
}

function publicationAuthorization(
  lease: Extract<
    Awaited<ReturnType<ReturnType<typeof createPostgresRefreshOperations>['claim']>>,
    { kind: 'statistics-publication' }
  >,
) {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    kind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    generationId: lease.payload.generationId,
    product: lease.payload.product,
  }
}

describe('Statistics full launch cohort publication', () => {
  test('persists 18 cells, fences immutable product decisions, retains prior valid, and replays without duplication', async () => {
    let statistics = createPostgresStatistics(connectionString)
    const concurrent = createPostgresStatistics(connectionString)
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const [first, duplicate] = await Promise.all([
        statistics.reconcileLaunchCohort(snapshots(1)),
        concurrent.reconcileLaunchCohort(snapshots(1)),
      ])
      expect(duplicate.generationId).toBe(first.generationId)
      expect(first.cells).toHaveLength(18)
      expect(first.cells.every((cell) => cell.selectedPlayers === 125 && cell.state === 'ready')).toBe(true)
      expect(first.selectedPlayers).toBe(2_250)
      expect(first.progress.ranked).toMatchObject({
        product: 'ranked',
        selectedPlayers: 2_250,
        operations: 0,
        sourceAttempts: 0,
        successes: 0,
      })
      expect(first.progress.ranked.cells).toHaveLength(18)
      expect(first.progress.lifetime).toMatchObject({ product: 'lifetime', selectedPlayers: 2_250, successes: 0 })
      expect(first.observationWindow.startsAt).not.toBe(first.sourceObservedAt)
      expect(
        new Date(first.observationWindow.endsAt).getTime() - new Date(first.observationWindow.startsAt).getTime(),
      ).toBe(7 * 24 * 60 * 60 * 1_000)
      expect(first.capacityEnvelope).toMatchObject({
        plannedRequests: 4_500,
        maximumSourceAttempts: 13_500,
        quotaUnitsPerWindow: 150,
        quotaWindowSeconds: 900,
      })
      expect(await statistics.collectionIntents()).toHaveLength(500)

      await seedTerminalProduct(first, 'ranked', 119)
      await seedTerminalProduct(first, 'lifetime', 119)
      expect(await statistics.collectionIntents()).toEqual([])

      const replayControl = postgres(connectionString, { max: 1 })
      const replayOperations = createPostgresDeadLetterOperations(connectionString)
      try {
        const bindings = await replayControl<
          { cohort_id: string; brawlhalla_id: string | number; operation_id: string }[]
        >`
          SELECT collection.cohort_id, collection.brawlhalla_id, collection.operation_id
          FROM statistics.collection_operations collection
          JOIN statistics.cohorts cohort ON cohort.id = collection.cohort_id
          WHERE cohort.generation_id = ${first.generationId} AND collection.product = 'ranked'
          ORDER BY collection.cohort_id, collection.brawlhalla_id
          LIMIT 2
        `
        await expectPostgresRejection(async () => {
          await replayControl`
            INSERT INTO statistics.collection_attempts
              (cohort_id, brawlhalla_id, product, operation_id, effect_operation_id, attempt_number, lease_token)
            VALUES (${bindings[0].cohort_id}, ${bindings[0].brawlhalla_id}, 'ranked',
              ${bindings[1].operation_id}, ${bindings[1].operation_id}, 999, 1)
          `
        }, 'collection attempt operation identity conflicts')
        await expectPostgresRejection(async () => {
          await replayControl`
            INSERT INTO statistics.publication_operations (generation_id, product, operation_id)
            VALUES (${first.generationId}, 'ranked', ${bindings[0].operation_id})
          `
        }, 'publication operation identity conflicts')

        const [rankedRoot] = await replayControl<{ id: string }[]>`
          SELECT operation.id
          FROM refresh_operations.operations operation
          JOIN statistics.collection_operations collection ON collection.operation_id = operation.effect_operation_id
          JOIN statistics.cohorts cohort ON cohort.id = collection.cohort_id
          WHERE cohort.generation_id = ${first.generationId}
            AND collection.product = 'ranked' AND operation.status = 'dead_letter'
            AND operation.replayed_from_operation_id IS NULL
          LIMIT 1
        `
        const firstReplay = await replayOperations.replayDeadLetter({
          operationId: rankedRoot.id,
          actorId: 'operator:statistics-210',
          reason: 'prepare descendant replay race',
        })
        if (!firstReplay.replayOperationId) throw new Error('first replay operation missing')
        await replayControl`
          UPDATE refresh_operations.operations SET status = 'dead_letter', completed_at = clock_timestamp()
          WHERE id = ${firstReplay.replayOperationId}
        `
        await replayControl.unsafe(`
          CREATE FUNCTION refresh_operations.pause_statistics_descendant_replay() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.replayed_from_operation_id IS NOT NULL THEN PERFORM pg_sleep(0.2); END IF;
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER pause_statistics_descendant_replay
          BEFORE INSERT ON refresh_operations.operations
          FOR EACH ROW EXECUTE FUNCTION refresh_operations.pause_statistics_descendant_replay();
        `)
        const rankedIntent = (await statistics.publicationIntents()).find(({ product }) => product === 'ranked')
        if (!rankedIntent) throw new Error('ranked publication intent missing')
        const reserved = await operations.reserveStatisticsPublication({
          kind: rankedIntent.kind,
          dedupeKey: rankedIntent.operationKey,
          operationKey: rankedIntent.operationKey,
          workClass: 'global-statistics',
          payload: { generationId: rankedIntent.generationId, product: rankedIntent.product },
          provenance: { source: 'statistics-publication-validation', requestedBy: 'issue-210' },
          maxAttempts: 3,
        })
        const descendantReplay = replayOperations.replayDeadLetter({
          operationId: firstReplay.replayOperationId,
          actorId: 'operator:statistics-210',
          reason: 'race publication sealing',
        })
        await Bun.sleep(50)
        const [replayed, sealResult] = await Promise.all([
          descendantReplay,
          statistics.recordPublicationOperation(rankedIntent, reserved.operationId),
        ])
        expect(sealResult).toBe('collection-active')
        if (!replayed.replayOperationId) throw new Error('descendant replay operation missing')
        await replayControl`
          UPDATE refresh_operations.operations SET status = 'dead_letter', completed_at = clock_timestamp()
          WHERE id = ${replayed.replayOperationId}
        `
      } finally {
        await replayControl.unsafe(`
          DROP TRIGGER IF EXISTS pause_statistics_descendant_replay ON refresh_operations.operations;
          DROP FUNCTION IF EXISTS refresh_operations.pause_statistics_descendant_replay();
        `)
        await replayOperations.close()
        await replayControl.end()
      }

      await bindPublication(statistics, operations, first.generationId, 'ranked')
      await bindPublication(statistics, operations, first.generationId, 'lifetime')

      const sealedControl = postgres(connectionString, { max: 1 })
      const [lifetimePublication] = await sealedControl<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.publication_operations
        WHERE generation_id = ${first.generationId} AND product = 'lifetime'
      `
      await expectPostgresRejection(async () => {
        await sealedControl`
          INSERT INTO statistics.publication_decisions
            (id, generation_id, product, effect_operation_id, operation_key, lease_token, decision,
             reasons, progress, observation_window, capacity_envelope)
          VALUES (${randomUUID()}, ${first.generationId}, 'lifetime', ${lifetimePublication.operation_id},
            'statistics:wrong:publication:lifetime', 1, 'rejected',
            '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
        `
      }, 'publication decision operation identity conflicts')
      const [sealedCollection] = await sealedControl<{ id: string }[]>`
        SELECT operation.id
        FROM refresh_operations.operations operation
        JOIN statistics.collection_operations collection ON collection.operation_id = operation.effect_operation_id
        JOIN statistics.cohorts cohort ON cohort.id = collection.cohort_id
        WHERE cohort.generation_id = ${first.generationId}
          AND collection.product = 'ranked' AND operation.status = 'dead_letter'
        LIMIT 1
      `
      await sealedControl.end()
      const sealedDeadLetters = createPostgresDeadLetterOperations(connectionString)
      try {
        await expect(
          sealedDeadLetters.replayDeadLetter({
            operationId: sealedCollection.id,
            actorId: 'operator:statistics-210',
            reason: 'must not race publication validation',
          }),
        ).rejects.toThrow('sealed by publication validation')
      } finally {
        await sealedDeadLetters.close()
      }

      const expired = await operations.claim('expired-publication', 20, admission, 'statistics-publication')
      if (!expired || expired.kind !== 'statistics-publication') throw new Error('publication lease missing')
      await Bun.sleep(35)
      const replacement = await operations.claim('replacement-publication', 10_000, admission, 'statistics-publication')
      if (!replacement || replacement.kind !== 'statistics-publication') throw new Error('replacement lease missing')
      expect((await statistics.validateAndPublish(publicationAuthorization(expired))).result).toBe('lease-lost')
      const concurrentPublication = await Promise.all([
        statistics.validateAndPublish(publicationAuthorization(replacement)),
        concurrent.validateAndPublish(publicationAuthorization(replacement)),
      ])
      expect(concurrentPublication.map(({ result }) => result).sort()).toEqual(['already-applied', 'applied'])
      const accepted = concurrentPublication.find(({ result }) => result === 'applied')
      expect(accepted?.decision).toMatchObject({
        outcome: 'accepted',
        progress: {
          selectedPlayers: 2_250,
          operations: 2_250,
          sourceAttempts: 2_250,
          successes: 2_142,
        },
        observationWindow: first.observationWindow,
        capacityEnvelope: first.capacityEnvelope,
      })
      expect(accepted?.decision?.progress.cells).toHaveLength(18)
      expect(
        accepted?.decision?.progress.cells.every(
          (cell) => cell.operations === 125 && cell.sourceAttempts === 125 && cell.successes === 119,
        ),
      ).toBe(true)
      await operations.complete(replacement)

      expect(
        await runOneRefreshOperation(operations, 'lifetime-publication-worker', {
          leaseMs: 10_000,
          retryDelayMs: 0,
          admission,
          statistics,
        }),
      ).toBe(true)
      const completedFirst = await statistics.getLaunchCohort(first.generationId)
      expect(completedFirst?.decisions).toHaveLength(2)
      expect(completedFirst?.progress.ranked).toMatchObject({
        operations: 2_250,
        sourceAttempts: 2_250,
        successes: 2_142,
      })
      expect(completedFirst?.progress.lifetime).toMatchObject({
        operations: 2_250,
        sourceAttempts: 2_250,
        successes: 2_142,
      })
      for (const statement of [
        "UPDATE statistics.publication_decisions SET decision = 'rejected'",
        'DELETE FROM statistics.publication_decisions',
        'TRUNCATE statistics.publication_decisions',
      ]) {
        const mutation = Bun.spawn(['psql', connectionString, '-v', 'ON_ERROR_STOP=1', '-c', statement], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const [exitCode, stderr] = await Promise.all([
          mutation.exited,
          new Response(mutation.stderr).text(),
          new Response(mutation.stdout).text(),
        ])
        expect(exitCode).not.toBe(0)
        expect(stderr).toContain('statistics cohort evidence is immutable')
      }

      const second = await statistics.reconcileLaunchCohort(snapshots(2))
      expect(second.generationId).not.toBe(first.generationId)
      await seedTerminalProduct(second, 'ranked', 118)
      const rejectedOperationId = await bindPublication(statistics, operations, second.generationId, 'ranked')
      expect(
        await runOneRefreshOperation(operations, 'rejected-publication-worker', {
          leaseMs: 10_000,
          retryDelayMs: 0,
          admission,
          statistics,
        }),
      ).toBe(true)

      const publication = await statistics.getPublication('ranked')
      expect(publication).toMatchObject({
        stale: true,
        active: { generationId: first.generationId, outcome: 'accepted' },
        latestDecision: { generationId: second.generationId, outcome: 'rejected' },
      })
      expect(publication?.latestDecision.reasons).toContainEqual({ code: 'overall-coverage-below-95-percent' })

      const control = postgres(connectionString, { max: 1 })
      await control`
        UPDATE refresh_operations.operations
        SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
            completed_at = clock_timestamp()
        WHERE id = ${rejectedOperationId}
      `
      await control.end()
      const deadLetters = createPostgresDeadLetterOperations(connectionString)
      try {
        const replay = await deadLetters.replayDeadLetter({
          operationId: rejectedOperationId,
          actorId: 'operator:statistics-210',
          reason: 'verify immutable publication replay',
        })
        expect(replay.outcome).toBe('replayed')
      } finally {
        await deadLetters.close()
      }
      expect(
        await runOneRefreshOperation(operations, 'publication-replay-worker', {
          leaseMs: 10_000,
          retryDelayMs: 0,
          admission,
          statistics,
        }),
      ).toBe(true)
      expect((await statistics.getLaunchCohort(second.generationId))?.decisions).toHaveLength(1)

      await statistics.close()
      statistics = createPostgresStatistics(connectionString)
      expect((await statistics.getPublication('ranked'))?.active?.generationId).toBe(first.generationId)
    } finally {
      await statistics.close()
      await concurrent.close()
      await operations.close()
    }
  }, 60_000)
})

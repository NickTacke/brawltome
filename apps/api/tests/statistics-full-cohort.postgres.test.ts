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
}, 30_000)

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
             generation.observation_window_starts_at + interval '2 hours', 1,
             CASE
               WHEN collection.product = 'ranked' THEN jsonb_build_object(
                 'brawlhallaId', member.brawlhalla_id,
                 'games', 10,
                 'wins', 5,
                 'rating', member.source_rating,
                 'peakRating', member.source_rating,
                 'tier', 'Observed',
                 'region', cohort.region,
                 'legends', jsonb_build_array(jsonb_build_object(
                   'legendId', 3,
                   'games', 10,
                   'wins', 5,
                   'rating', member.source_rating,
                   'peakRating', member.source_rating,
                   'tier', 'Observed'
                 ))
               )
               WHEN collection.product = 'lifetime' THEN jsonb_build_object(
                 'brawlhallaId', member.brawlhalla_id,
                 'games', 100,
                 'wins', 50,
                 'combat', jsonb_build_object(
                   'damage_bomb', 0, 'damage_mine', 0, 'damage_spikeball', 0, 'damage_sidekick', 0,
                   'hit_snowball', 0, 'ko_bomb', 0, 'ko_mine', 0, 'ko_sidekick', 0,
                   'ko_snowball', 0, 'ko_spikeball', 0
                 ),
                 'legends', jsonb_build_array(jsonb_build_object(
                   'legendId', 3, 'games', 100, 'wins', 50,
                   'damageDealt', 999999, 'damageTaken', 800000, 'kos', 999, 'falls', 500,
                   'suicides', 2, 'teamKos', 1, 'matchTime', 20000,
                   'damageUnarmed', 50000, 'damageThrownItem', 10000,
                   'damageWeaponOne', 600, 'damageWeaponTwo', 0, 'damageGadgets', 5000,
                   'koUnarmed', 100, 'koWeaponOne', 1, 'koWeaponTwo', 0, 'koGadgets', 50,
                   'timeHeldWeaponOne', 3600, 'timeHeldWeaponTwo', 1800
                 ))
               )
               ELSE '{}'::jsonb
             END
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

async function bindLegendMetaPublication(
  statistics: ReturnType<typeof createPostgresStatistics>,
  operations: ReturnType<typeof createPostgresRefreshOperations>,
  generationId: string,
  maxAttempts = 3,
) {
  const intent = (await statistics.legendMetaPublicationIntents()).find(
    (candidate) => candidate.generationId === generationId,
  )
  if (!intent) throw new Error('missing Legend Meta publication intent')
  const reserved = await operations.reserveStatisticsLegendMetaPublication({
    kind: intent.kind,
    dedupeKey: intent.operationKey,
    operationKey: intent.operationKey,
    workClass: 'global-statistics',
    payload: { generationId },
    provenance: { source: 'statistics-legend-meta-publication', requestedBy: 'issue-211' },
    maxAttempts,
  })
  await statistics.recordLegendMetaPublicationOperation(intent, reserved.operationId)
  expect(await operations.activateStatisticsLegendMetaPublication(reserved.operationId)).toBe('transitioned')
  return reserved.operationId
}

async function bindPublicationFixture(
  operations: ReturnType<typeof createPostgresRefreshOperations>,
  generationId: string,
  product: 'ranked' | 'lifetime',
) {
  const operationKey = `statistics:${generationId}:publication:${product}`
  const reserved = await operations.reserveStatisticsPublication({
    kind: 'statistics-publication',
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics',
    payload: { generationId, product },
    provenance: { source: 'statistics-publication-ordering-fixture', requestedBy: 'issue-211' },
    maxAttempts: 1,
  })
  const sql = postgres(connectionString, { max: 1 })
  try {
    await sql`
      INSERT INTO statistics.publication_operations (generation_id, product, operation_id)
      VALUES (${generationId}, ${product}, ${reserved.operationId})
    `
  } finally {
    await sql.end()
  }
  return reserved.operationId
}

async function insertAcceptedPublicationFixture(input: {
  generationId: string
  operationId: string
  product: 'ranked' | 'lifetime'
  templateGenerationId: string
}) {
  const sql = postgres(connectionString, { max: 1 })
  try {
    await sql`
      INSERT INTO statistics.publication_decisions
        (id, generation_id, product, effect_operation_id, operation_key, lease_token,
         decision, reasons, progress, observation_window, capacity_envelope)
      SELECT ${randomUUID()}, ${input.generationId}, ${input.product}, ${input.operationId},
             ${`statistics:${input.generationId}:publication:${input.product}`}, 1,
             'accepted', '[]'::jsonb, progress, observation_window, capacity_envelope
      FROM statistics.publication_decisions
      WHERE generation_id = ${input.templateGenerationId} AND product = ${input.product}
    `
  } finally {
    await sql.end()
  }
}

async function cloneCareerSnapshotFixture(input: { generationId: string; templateGenerationId: string }) {
  const sql = postgres(connectionString, { max: 1 })
  const snapshotId = randomUUID()
  try {
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as typeof sql
      await tx`
        INSERT INTO statistics.career_weapon_usage_snapshots
          (id, generation_id, cohort_methodology_version, methodology_version,
           publication_decision_id, published_at)
        SELECT ${snapshotId}, ${input.generationId}, generation.methodology_version,
               template.methodology_version, decision.id, decision.decided_at
        FROM statistics.publication_decisions decision
        JOIN statistics.cohort_generations generation ON generation.id = decision.generation_id
        JOIN statistics.career_weapon_usage_snapshots template
          ON template.generation_id = ${input.templateGenerationId}
        WHERE decision.generation_id = ${input.generationId}
          AND decision.product = 'lifetime' AND decision.decision = 'accepted'
      `
      await tx`
        INSERT INTO statistics.career_weapon_usage_scopes
          (snapshot_id, region, bracket, selected_players, successful_observations, total_held_seconds)
        SELECT ${snapshotId}, region, bracket, selected_players, successful_observations, total_held_seconds
        FROM statistics.career_weapon_usage_scopes
        WHERE snapshot_id = (
          SELECT id FROM statistics.career_weapon_usage_snapshots
          WHERE generation_id = ${input.templateGenerationId}
        )
      `
      await tx`
        INSERT INTO statistics.career_weapon_usage_rows
          (snapshot_id, region, bracket, weapon, observed_players, held_time_seconds,
           contributor_count, qualifying_held_seconds, median_damage_numerator,
           median_damage_denominator, median_kos_numerator, median_kos_denominator,
           comparison_eligible, comparison_reasons)
        SELECT ${snapshotId}, region, bracket, weapon, observed_players, held_time_seconds,
               contributor_count, qualifying_held_seconds, median_damage_numerator,
               median_damage_denominator, median_kos_numerator, median_kos_denominator,
               comparison_eligible, comparison_reasons
        FROM statistics.career_weapon_usage_rows
        WHERE snapshot_id = (
          SELECT id FROM statistics.career_weapon_usage_snapshots
          WHERE generation_id = ${input.templateGenerationId}
        )
      `
      await tx`
        UPDATE statistics.career_weapon_usage_snapshots
        SET sealed_at = clock_timestamp()
        WHERE id = ${snapshotId}
      `
    })
  } finally {
    await sql.end()
  }
  return snapshotId
}

function legendMetaAuthorization(
  lease: Extract<
    Awaited<ReturnType<ReturnType<typeof createPostgresRefreshOperations>['claim']>>,
    { kind: 'statistics-legend-meta-publication' }
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
  }
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

      const careerLease = await operations.claim(
        'career-publication-worker',
        10_000,
        admission,
        'statistics-publication',
      )
      if (!careerLease || careerLease.kind !== 'statistics-publication') {
        throw new Error('Career publication lease missing')
      }
      const concurrentCareerPublication = await Promise.all([
        statistics.validateAndPublish(publicationAuthorization(careerLease)),
        concurrent.validateAndPublish(publicationAuthorization(careerLease)),
      ])
      expect(concurrentCareerPublication.map(({ result }) => result).sort()).toEqual(['already-applied', 'applied'])
      expect(concurrentCareerPublication.find(({ result }) => result === 'applied')?.decision?.outcome).toBe('accepted')
      await operations.complete(careerLease)
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

      const legendMetaOperationId = await bindLegendMetaPublication(statistics, operations, first.generationId, 2)
      const expiredLegendMeta = await operations.claim(
        'expired-legend-meta',
        20,
        admission,
        'statistics-legend-meta-publication',
      )
      if (!expiredLegendMeta || expiredLegendMeta.kind !== 'statistics-legend-meta-publication') {
        throw new Error('Legend Meta publication lease missing')
      }
      await Bun.sleep(35)
      const replacementLegendMeta = await operations.claim(
        'replacement-legend-meta',
        10_000,
        admission,
        'statistics-legend-meta-publication',
      )
      if (!replacementLegendMeta || replacementLegendMeta.kind !== 'statistics-legend-meta-publication') {
        throw new Error('replacement Legend Meta publication lease missing')
      }
      expect((await statistics.buildAndPublishLegendMeta(legendMetaAuthorization(expiredLegendMeta))).result).toBe(
        'lease-lost',
      )
      const concurrentLegendMeta = await Promise.all([
        statistics.buildAndPublishLegendMeta(legendMetaAuthorization(replacementLegendMeta)),
        concurrent.buildAndPublishLegendMeta(legendMetaAuthorization(replacementLegendMeta)),
      ])
      expect(concurrentLegendMeta.map(({ result }) => result).sort()).toEqual(['already-applied', 'applied'])
      expect(concurrentLegendMeta.find(({ result }) => result === 'applied')?.decision).toMatchObject({
        generationId: first.generationId,
        outcome: 'accepted',
        reasons: [],
      })
      const recoveryControl = postgres(connectionString, { max: 1 })
      await recoveryControl`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() - interval '1 millisecond'
        WHERE id = ${legendMetaOperationId}
      `
      await recoveryControl.end()
      expect(
        await operations.claim('legend-meta-effect-recovery', 10_000, admission, 'statistics-legend-meta-publication'),
      ).toBeNull()
      expect((await operations.inspect(legendMetaOperationId)).operation).toMatchObject({
        status: 'succeeded',
        attempt_count: 2,
      })

      const initialLegendHistory = await statistics.getLegendMetaHistory({ region: 'all', bracket: 'all' })
      expect(initialLegendHistory).toMatchObject({
        status: 'available',
        region: 'all',
        bracket: 'all',
        entries: [
          {
            snapshot: { generationId: first.generationId },
            comparisonToPrevious: null,
          },
        ],
      })

      const allLegendMeta = await statistics.getLegendMeta({ region: 'all', bracket: 'all' })
      expect(allLegendMeta).toMatchObject({
        status: 'fresh',
        generationId: first.generationId,
        methodologyVersion: 'current-season-legend-meta-v1',
        season: { scope: 'current-season', identity: null, source: 'brawlhalla-v1-ranked-1v1' },
        slice: {
          selectedPlayers: 2_250,
          observedPlayers: 2_142,
          observedLegendGames: 21_420,
          coverage: { numerator: 2_142, denominator: 2_250, basisPoints: 9_520 },
        },
      })
      if (allLegendMeta.status === 'unavailable') throw new Error('Legend Meta publication missing')
      expect(allLegendMeta.slice.rows.find(({ legend }) => legend.legendId === 3)).toMatchObject({
        rank: 1,
        eligible: true,
        playerCount: 2_142,
        gameCount: 21_420,
        winCount: 10_710,
        medianRating: 1_902,
        pickShare: { numerator: 21_420, denominator: 21_420, basisPoints: 10_000 },
        adoption: { numerator: 2_142, denominator: 2_142, basisPoints: 10_000 },
        winRate: { numerator: 10_710, denominator: 21_420, basisPoints: 5_000 },
      })
      const euPlatinum = await statistics.getLegendMeta({ region: 'EU', bracket: 'Platinum' })
      expect(euPlatinum).toMatchObject({
        status: 'fresh',
        slice: {
          selectedPlayers: 125,
          observedPlayers: 119,
          observedLegendGames: 1_190,
          coverage: { numerator: 119, denominator: 125, basisPoints: 9_520 },
        },
      })
      const overdueStatistics = createPostgresStatistics(connectionString, {
        now: () => new Date('2100-01-01T00:00:00.000Z'),
      })
      try {
        await expect(overdueStatistics.getLegendMeta({ region: 'all', bracket: 'all' })).resolves.toMatchObject({
          status: 'stale',
          staleReason: 'publication-overdue',
          generationId: first.generationId,
        })
      } finally {
        await overdueStatistics.close()
      }

      const initialCareerHistory = await statistics.getCareerWeaponUsageHistory({ region: 'all', bracket: 'all' })
      expect(initialCareerHistory).toMatchObject({
        status: 'available',
        filters: { region: 'all', bracket: 'all' },
        entries: [
          {
            snapshot: { generationId: first.generationId },
            comparisonToPrevious: null,
          },
        ],
      })

      const freshCareer = await statistics.getCareerWeaponUsage({ region: 'all', bracket: 'all' })
      expect(freshCareer).toMatchObject({
        status: 'fresh',
        generationId: first.generationId,
        cohortMethodologyVersion: first.methodologyVersion,
        methodologyVersion: 'career-weapon-usage-v1',
        observationWindow: first.observationWindow,
        expectedNextPublicationAt: new Date(
          new Date(first.observationWindow.endsAt).getTime() + 7 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
        selectedPlayers: 2_250,
        successfulObservations: 2_142,
        coverage: { numerator: '119', denominator: '125' },
        totalHeldSeconds: '11566800',
        filters: { region: 'all', bracket: 'all' },
      })
      if (!freshCareer || freshCareer.status === 'unavailable') throw new Error('Career publication missing')
      expect(freshCareer.rows.find(({ weapon }) => weapon === 'Hammer')).toEqual({
        weapon: 'Hammer',
        observedPlayers: 2_142,
        prevalence: { numerator: '1', denominator: '1' },
        heldTimeSeconds: '7711200',
        heldTimeShare: { numerator: '2', denominator: '3' },
        contributorCount: 2_142,
        qualifyingHeldSeconds: '7711200',
        medianDamagePerMinute: { numerator: '10', denominator: '1' },
        medianKosPerHour: { numerator: '1', denominator: '1' },
        comparison: { eligible: true, reasons: [] },
      })
      expect(freshCareer.rows.find(({ weapon }) => weapon === 'Sword')).toMatchObject({
        observedPlayers: 2_142,
        heldTimeShare: { numerator: '1', denominator: '3' },
        medianDamagePerMinute: { numerator: '0', denominator: '1' },
        medianKosPerHour: { numerator: '0', denominator: '1' },
      })
      expect(await statistics.getCareerWeaponUsage({ region: 'EU', bracket: 'Diamond+' })).toMatchObject({
        status: 'fresh',
        selectedPlayers: 125,
        successfulObservations: 119,
        coverage: { numerator: '119', denominator: '125' },
        filters: { region: 'EU', bracket: 'Diamond+' },
      })
      const overdueCareer = createPostgresStatistics(connectionString, {
        now: () => new Date(new Date(freshCareer.expectedNextPublicationAt).getTime() + 1),
      })
      try {
        expect(await overdueCareer.getCareerWeaponUsage({ region: 'all', bracket: 'all' })).toMatchObject({
          status: 'stale',
          generationId: first.generationId,
          latestDecision: { generationId: first.generationId, outcome: 'accepted' },
        })
      } finally {
        await overdueCareer.close()
      }
      for (const statement of [
        "UPDATE statistics.publication_decisions SET decision = 'rejected'",
        'DELETE FROM statistics.publication_decisions',
        'TRUNCATE statistics.publication_decisions',
        "UPDATE statistics.legend_meta_publication_decisions SET decision = 'rejected'",
        'DELETE FROM statistics.legend_meta_publication_decisions',
        'TRUNCATE statistics.legend_meta_publication_decisions',
        'DELETE FROM statistics.legend_meta_publication_operations',
        'TRUNCATE statistics.legend_meta_publication_operations, statistics.legend_meta_publication_decisions',
        'UPDATE statistics.career_weapon_usage_snapshots SET published_at = clock_timestamp()',
        'UPDATE statistics.career_weapon_usage_scopes SET selected_players = selected_players + 1',
        'UPDATE statistics.career_weapon_usage_rows SET held_time_seconds = held_time_seconds + 1',
        `INSERT INTO statistics.career_weapon_usage_rows
          (snapshot_id, region, bracket, weapon, observed_players, held_time_seconds,
           contributor_count, qualifying_held_seconds, comparison_eligible, comparison_reasons)
         SELECT snapshot_id, region, bracket, 'Fabricated', 0, 0, 0, 0, false,
                '["contributors-below-30"]'::jsonb
         FROM statistics.career_weapon_usage_scopes WHERE region = 'all' AND bracket = 'all' LIMIT 1`,
        'TRUNCATE statistics.career_weapon_usage_rows',
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

      const secondSnapshots = snapshots(2)
      const duplicatedPlayerId = secondSnapshots[1]?.candidates[0]?.brawlhallaId
      if (!duplicatedPlayerId || !secondSnapshots[0]?.candidates[124]) throw new Error('duplicate fixture missing')
      secondSnapshots[0].candidates[124].brawlhallaId = duplicatedPlayerId
      const second = await statistics.reconcileLaunchCohort(secondSnapshots)
      expect(second.generationId).not.toBe(first.generationId)
      await seedTerminalProduct(second, 'ranked', 118)
      await seedTerminalProduct(second, 'lifetime', 119)
      const rejectedOperationId = await bindPublication(statistics, operations, second.generationId, 'ranked')
      await bindPublication(statistics, operations, second.generationId, 'lifetime')
      expect(
        await runOneRefreshOperation(operations, 'rejected-publication-worker', {
          leaseMs: 10_000,
          retryDelayMs: 0,
          admission,
          statistics,
        }),
      ).toBe(true)
      expect(
        await runOneRefreshOperation(operations, 'rejected-career-publication-worker', {
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
      expect(await statistics.getCareerWeaponUsage({ region: 'all', bracket: 'all' })).toMatchObject({
        status: 'stale',
        generationId: first.generationId,
        latestDecision: {
          generationId: second.generationId,
          outcome: 'rejected',
          reasons: [{ code: 'career-weapon-duplicate-player', brawlhallaId: duplicatedPlayerId }],
        },
      })

      const third = await statistics.reconcileLaunchCohort(snapshots(3))
      const thirdRankedOperationId = await bindPublicationFixture(operations, third.generationId, 'ranked')
      await insertAcceptedPublicationFixture({
        generationId: third.generationId,
        operationId: thirdRankedOperationId,
        product: 'ranked',
        templateGenerationId: first.generationId,
      })
      const thirdLifetimeOperationId = await bindPublicationFixture(operations, third.generationId, 'lifetime')
      await insertAcceptedPublicationFixture({
        generationId: third.generationId,
        operationId: thirdLifetimeOperationId,
        product: 'lifetime',
        templateGenerationId: first.generationId,
      })
      const thirdCareerSnapshotId = await cloneCareerSnapshotFixture({
        generationId: third.generationId,
        templateGenerationId: first.generationId,
      })
      await bindLegendMetaPublication(statistics, operations, third.generationId)
      const acceptedThirdLegendMeta = await operations.claim(
        'accepted-third-legend-meta',
        10_000,
        admission,
        'statistics-legend-meta-publication',
      )
      if (!acceptedThirdLegendMeta || acceptedThirdLegendMeta.kind !== 'statistics-legend-meta-publication') {
        throw new Error('third Legend Meta publication lease missing')
      }
      expect(
        await statistics.buildAndPublishLegendMeta(legendMetaAuthorization(acceptedThirdLegendMeta)),
      ).toMatchObject({
        result: 'applied',
        decision: { generationId: third.generationId, outcome: 'accepted' },
      })
      await operations.complete(acceptedThirdLegendMeta)

      await bindLegendMetaPublication(statistics, operations, second.generationId)
      const rejectedLegendMeta = await operations.claim(
        'rejected-legend-meta',
        10_000,
        admission,
        'statistics-legend-meta-publication',
      )
      if (!rejectedLegendMeta || rejectedLegendMeta.kind !== 'statistics-legend-meta-publication') {
        throw new Error('rejected Legend Meta publication lease missing')
      }
      expect(await statistics.buildAndPublishLegendMeta(legendMetaAuthorization(rejectedLegendMeta))).toMatchObject({
        result: 'applied',
        decision: {
          generationId: second.generationId,
          outcome: 'rejected',
          reasons: [{ code: 'ranked-publication-rejected' }],
          snapshotId: null,
        },
      })
      await operations.complete(rejectedLegendMeta)
      await expect(statistics.getLegendMeta({ region: 'all', bracket: 'all' })).resolves.toMatchObject({
        status: 'fresh',
        staleReason: null,
        generationId: third.generationId,
      })
      await expect(statistics.getLegendMetaHistory({ region: 'all', bracket: 'all' })).resolves.toMatchObject({
        status: 'available',
        entries: [
          {
            snapshot: { generationId: third.generationId },
            comparisonToPrevious: {
              status: 'incompatible',
              previousSnapshotId: allLegendMeta.snapshotId,
              reasons: [{ code: 'season_identity_unavailable' }],
            },
          },
          {
            snapshot: { generationId: first.generationId },
            comparisonToPrevious: null,
          },
        ],
      })
      const compatibleCareerHistory = await statistics.getCareerWeaponUsageHistory({ region: 'all', bracket: 'all' })
      if (compatibleCareerHistory.status === 'unavailable') throw new Error('Career history missing')
      expect(compatibleCareerHistory.entries).toHaveLength(2)
      expect(compatibleCareerHistory.entries[0]?.snapshot).toMatchObject({
        snapshotId: thirdCareerSnapshotId,
        generationId: third.generationId,
      })
      const careerComparison = compatibleCareerHistory.entries[0]?.comparisonToPrevious
      expect(careerComparison).toMatchObject({
        status: 'available',
        previousSnapshotId: freshCareer.snapshotId,
      })
      if (careerComparison?.status !== 'available') throw new Error('compatible Career delta missing')
      expect(careerComparison.deltas.find(({ weapon }) => weapon === 'Hammer')).toMatchObject({
        prevalence: { changeBasisPoints: 0, direction: 'unchanged' },
        medianDamagePerMinute: {
          change: { numerator: '0', denominator: '1' },
          direction: 'unchanged',
        },
      })
      expect(compatibleCareerHistory.entries[1]).toMatchObject({
        snapshot: { snapshotId: freshCareer.snapshotId, generationId: first.generationId },
        comparisonToPrevious: null,
      })

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
      expect((await statistics.getLaunchCohort(second.generationId))?.decisions).toHaveLength(2)

      await statistics.close()
      statistics = createPostgresStatistics(connectionString)
      expect((await statistics.getPublication('ranked'))?.active?.generationId).toBe(third.generationId)
      expect(await statistics.getCareerWeaponUsage({ region: 'all', bracket: 'all' })).toMatchObject({
        status: 'fresh',
        snapshotId: thirdCareerSnapshotId,
        generationId: third.generationId,
        latestDecision: { generationId: third.generationId, outcome: 'accepted' },
      })
    } finally {
      await statistics.close()
      await concurrent.close()
      await operations.close()
    }
  }, 120_000)
})

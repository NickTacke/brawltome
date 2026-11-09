import type { LaunchCohortAudit } from '@brawltome/statistics'
import postgres from 'postgres'

// writes every collection of a generation as already finished, with an observation for the first players of each cell
export async function seedTerminalProduct(
  connectionString: string,
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
      INSERT INTO queue.operations
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
      JOIN queue.operations operation
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
      JOIN queue.operations operation ON operation.id = collection.operation_id
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
                 'legends', jsonb_build_array(
                   jsonb_build_object(
                     'legendId', 3,
                     'games', 10,
                     'wins', 5,
                     'rating', member.source_rating,
                     'peakRating', member.source_rating,
                     'tier', 'Observed'
                   ),
                   jsonb_build_object(
                     'legendId', 4,
                     'games', 0,
                     'wins', 0,
                     'rating', 750,
                     'peakRating', 750,
                     'tier', 'Observed'
                   )
                 )
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
      JOIN queue.operations operation ON operation.id = collection.operation_id
      WHERE cohort.generation_id = ${generation.generationId} AND collection.product = ${product}
        AND member.ordinal <= ${successesPerCell}
    `
  } finally {
    await sql.end()
  }
}

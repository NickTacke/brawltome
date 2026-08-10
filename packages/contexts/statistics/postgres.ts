import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { type CohortCandidateSnapshot, selectLaunchCohort } from './cohort'
import type {
  CohortAudit,
  CohortCollectionIntent,
  CollectionAuthorization,
  CollectionCommitResult,
  CollectionObservation,
  CollectionPreflightResult,
  CollectionProduct,
  StatisticsTracer,
} from './index'
import { validateLifetimeEvidence, validateRankedEvidence } from './source'

type CohortRow = {
  id: string
  methodology_version: string
  source_snapshot_id: string
  source_generation_id: string
  source_observed_at: Date
  region: 'EU'
  bracket: 'Diamond+'
  sample_cap: 750
  minimum_evidence_players: 125
  eligible_players: number
  selected_players: number
  evidence_state: 'ready' | 'insufficient-evidence'
}

type MemberRow = {
  brawlhalla_id: string | number
  source_rating: number
  ordinal: number
  selection_hash: string
  ranked_operation_id: string | null
  lifetime_operation_id: string | null
  ranked_succeeded_at: Date | null
  lifetime_succeeded_at: Date | null
}

function productFromKind(kind: CollectionAuthorization['kind']): CollectionProduct {
  return kind === 'statistics-ranked-collection' ? 'ranked' : 'lifetime'
}

function kindFromProduct(product: CollectionProduct): CohortCollectionIntent['kind'] {
  return product === 'ranked' ? 'statistics-ranked-collection' : 'statistics-lifetime-collection'
}

function operationKey(cohortId: string, brawlhallaId: number, product: CollectionProduct): string {
  return `statistics:${cohortId}:${brawlhallaId}:${product}`
}

export function createPostgresStatistics(connectionString: string) {
  const client = postgres(connectionString)

  async function audit(sql: typeof client): Promise<CohortAudit | null> {
    const [cohort] = await sql<CohortRow[]>`
      SELECT id, methodology_version, source_snapshot_id, source_generation_id, source_observed_at,
             region, bracket, sample_cap, minimum_evidence_players, eligible_players,
             selected_players, evidence_state
      FROM statistics.cohorts
      WHERE tracer_key = 'eu-diamond-plus'
    `
    if (!cohort) return null
    const members = await sql<MemberRow[]>`
      SELECT member.brawlhalla_id, member.source_rating, member.ordinal, member.selection_hash,
             ranked.operation_id AS ranked_operation_id,
             lifetime.operation_id AS lifetime_operation_id,
             ranked_observed.observed_at AS ranked_succeeded_at,
             lifetime_observed.observed_at AS lifetime_succeeded_at
      FROM statistics.cohort_members member
      LEFT JOIN statistics.collection_operations ranked
        ON ranked.cohort_id = member.cohort_id
       AND ranked.brawlhalla_id = member.brawlhalla_id
       AND ranked.product = 'ranked'
      LEFT JOIN statistics.collection_operations lifetime
        ON lifetime.cohort_id = member.cohort_id
       AND lifetime.brawlhalla_id = member.brawlhalla_id
       AND lifetime.product = 'lifetime'
      LEFT JOIN statistics.observations ranked_observed
        ON ranked_observed.cohort_id = member.cohort_id
       AND ranked_observed.brawlhalla_id = member.brawlhalla_id
       AND ranked_observed.product = 'ranked'
      LEFT JOIN statistics.observations lifetime_observed
        ON lifetime_observed.cohort_id = member.cohort_id
       AND lifetime_observed.brawlhalla_id = member.brawlhalla_id
       AND lifetime_observed.product = 'lifetime'
      WHERE member.cohort_id = ${cohort.id}
      ORDER BY member.ordinal
    `
    return {
      cohortId: cohort.id,
      methodologyVersion: cohort.methodology_version,
      sourceSnapshotId: cohort.source_snapshot_id,
      sourceGenerationId: cohort.source_generation_id,
      sourceObservedAt: cohort.source_observed_at.toISOString(),
      region: cohort.region,
      bracket: cohort.bracket,
      cap: cohort.sample_cap,
      minimumEvidencePlayers: cohort.minimum_evidence_players,
      eligiblePlayers: cohort.eligible_players,
      selectedPlayers: cohort.selected_players,
      state: cohort.evidence_state,
      members: members.map((member) => ({
        brawlhallaId: Number(member.brawlhalla_id),
        sourceRating: member.source_rating,
        ordinal: member.ordinal,
        selectionHash: member.selection_hash,
        rankedOperationId: member.ranked_operation_id,
        lifetimeOperationId: member.lifetime_operation_id,
        rankedSucceededAt: member.ranked_succeeded_at?.toISOString() ?? null,
        lifetimeSucceededAt: member.lifetime_succeeded_at?.toISOString() ?? null,
      })),
    }
  }

  const tracer: StatisticsTracer = {
    async reconcileCohort(snapshot: CohortCandidateSnapshot): Promise<CohortAudit> {
      const selected = selectLaunchCohort(snapshot)
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(hashtext('statistics:eu-diamond-plus'))`
        const existing = await audit(sql)
        if (existing) return existing

        const cohortId = randomUUID()
        await sql`
          INSERT INTO statistics.cohorts
            (id, tracer_key, methodology_version, source_snapshot_id, source_generation_id,
             source_observed_at, region, bracket, sample_cap, minimum_evidence_players,
             eligible_players, selected_players, evidence_state)
          VALUES
            (${cohortId}, 'eu-diamond-plus', ${selected.methodologyVersion}, ${selected.source.snapshotId},
             ${selected.source.generationId}, ${selected.source.observedAt}, ${selected.source.region},
             'Diamond+', ${selected.cap}, ${selected.minimumEvidencePlayers}, ${selected.eligiblePlayers},
             ${selected.selectedPlayers}, ${selected.state})
        `
        if (selected.members.length > 0) {
          await sql`
            INSERT INTO statistics.cohort_members ${sql(
              selected.members.map((member) => ({
                cohort_id: cohortId,
                brawlhalla_id: member.brawlhallaId,
                ordinal: member.ordinal,
                source_rating: member.sourceRating,
                selection_hash: member.selectionHash,
              })),
              'cohort_id',
              'brawlhalla_id',
              'ordinal',
              'source_rating',
              'selection_hash',
            )}
          `
        }
        const created = await audit(sql)
        if (!created) throw new Error('statistics cohort disappeared during reconciliation')
        return created
      })
    },

    async collectionIntents(): Promise<CohortCollectionIntent[]> {
      const rows = await client<{ cohort_id: string; brawlhalla_id: string | number; product: CollectionProduct }[]>`
        SELECT member.cohort_id, member.brawlhalla_id, product.product
        FROM statistics.cohort_members member
        CROSS JOIN (VALUES ('ranked'::text), ('lifetime'::text)) product(product)
        LEFT JOIN statistics.collection_operations operation
          ON operation.cohort_id = member.cohort_id
         AND operation.brawlhalla_id = member.brawlhalla_id
         AND operation.product = product.product
        WHERE operation.operation_id IS NULL
        ORDER BY member.ordinal, product.product DESC
      `
      return rows.map((row) => {
        const brawlhallaId = Number(row.brawlhalla_id)
        return {
          cohortId: row.cohort_id,
          brawlhallaId,
          product: row.product,
          kind: kindFromProduct(row.product),
          operationKey: operationKey(row.cohort_id, brawlhallaId, row.product),
        }
      })
    },

    async recordCollectionOperation(intent: CohortCollectionIntent, operationId: string): Promise<void> {
      const expectedKind = kindFromProduct(intent.product)
      if (
        intent.kind !== expectedKind ||
        intent.operationKey !== operationKey(intent.cohortId, intent.brawlhallaId, intent.product)
      ) {
        throw new Error('collection intent does not match the fixed operation identity')
      }
      await client`
        INSERT INTO statistics.collection_operations
          (cohort_id, brawlhalla_id, product, operation_id)
        VALUES (${intent.cohortId}, ${intent.brawlhallaId}, ${intent.product}, ${operationId})
        ON CONFLICT (cohort_id, brawlhalla_id, product) DO NOTHING
      `
      const [recorded] = await client<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.collection_operations
        WHERE cohort_id = ${intent.cohortId} AND brawlhalla_id = ${intent.brawlhallaId}
          AND product = ${intent.product}
      `
      if (recorded?.operation_id !== operationId) throw new Error('collection operation identity conflicts')
    },

    async preflightCollection(authorization: CollectionAuthorization): Promise<CollectionPreflightResult> {
      const product = productFromKind(authorization.kind)
      const identities = await client<
        {
          bound_operation_id: string
          observation_effect_operation_id: string | null
          observation_operation_key: string | null
          effect_operation_id: string | null
          effect_operation_key: string | null
          effect_kind: string | null
        }[]
      >`
        SELECT collection.operation_id AS bound_operation_id,
               observation.effect_operation_id AS observation_effect_operation_id,
               observation.operation_key AS observation_operation_key,
               effect.operation_id AS effect_operation_id,
               effect.operation_key AS effect_operation_key,
               effect.kind AS effect_kind
        FROM statistics.collection_operations collection
        LEFT JOIN statistics.observations observation
          ON observation.cohort_id = collection.cohort_id
         AND observation.brawlhalla_id = collection.brawlhalla_id
         AND observation.product = collection.product
        LEFT JOIN refresh_operations.statistics_collection_effects effect
          ON effect.operation_id = ${authorization.effectOperationId}
          OR effect.operation_key = ${authorization.operationKey}
        WHERE collection.cohort_id = ${authorization.cohortId}
          AND collection.brawlhalla_id = ${authorization.brawlhallaId}
          AND collection.product = ${product}
      `
      if (
        identities.length === 0 ||
        identities.some((identity) => identity.bound_operation_id !== authorization.effectOperationId)
      ) {
        return 'effect-conflict'
      }
      const observations = identities.filter((identity) => identity.observation_effect_operation_id !== null)
      const effects = identities.filter((identity) => identity.effect_operation_id !== null)
      if (observations.length === 0 && effects.length === 0) return 'missing'
      if (
        observations.length === 1 &&
        effects.length === 1 &&
        observations[0]?.observation_effect_operation_id === authorization.effectOperationId &&
        observations[0]?.observation_operation_key === authorization.operationKey &&
        effects[0]?.effect_operation_id === authorization.effectOperationId &&
        effects[0]?.effect_operation_key === authorization.operationKey &&
        effects[0]?.effect_kind === authorization.kind
      ) {
        return 'already-applied'
      }
      return 'effect-conflict'
    },

    async commitObservation(observation: CollectionObservation): Promise<CollectionCommitResult> {
      const { authorization } = observation
      const product = productFromKind(authorization.kind)
      const observedAt = observation.observedAt ?? new Date()
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [bound] = await sql<{ operation_id: string }[]>`
          SELECT operation_id FROM statistics.collection_operations
          WHERE cohort_id = ${authorization.cohortId}
            AND brawlhalla_id = ${authorization.brawlhallaId}
            AND product = ${product}
          FOR SHARE
        `
        if (!bound || bound.operation_id !== authorization.effectOperationId) return 'effect-conflict'
        const [effect] = await sql<{ result: CollectionCommitResult }[]>`
          SELECT refresh_operations.record_statistics_collection_effect(
            ${authorization.operationId}, ${authorization.operationKey}, ${authorization.kind},
            ${authorization.leaseOwner}, ${authorization.leaseToken}
          ) AS result
        `
        const result = effect?.result ?? 'lease-lost'
        if (result === 'lease-lost' || result === 'effect-conflict') return result

        const existingIdentity = async () => {
          const [existing] = await sql<{ matches: boolean }[]>`
            SELECT effect_operation_id = ${authorization.effectOperationId}
               AND operation_key = ${authorization.operationKey} AS matches
            FROM statistics.observations
            WHERE cohort_id = ${authorization.cohortId}
              AND brawlhalla_id = ${authorization.brawlhallaId}
              AND product = ${product}
          `
          return existing?.matches === true
        }
        if (result === 'already-applied') {
          return (await existingIdentity()) ? 'already-applied' : 'effect-conflict'
        }

        const evidence =
          observation.authorization.kind === 'statistics-ranked-collection'
            ? validateRankedEvidence(observation.evidence, authorization.brawlhallaId)
            : validateLifetimeEvidence(observation.evidence, authorization.brawlhallaId)
        const serializedEvidence = JSON.stringify(evidence)
        if (serializedEvidence === undefined) throw new Error('statistics evidence must be JSON serializable')
        const evidenceJson = JSON.parse(serializedEvidence) as postgres.JSONValue
        const inserted = await sql<{ effect_operation_id: string }[]>`
          INSERT INTO statistics.observations
            (cohort_id, brawlhalla_id, product, effect_operation_id, operation_key,
             lease_token, observed_at, evidence_version, evidence)
          VALUES
            (${authorization.cohortId}, ${authorization.brawlhallaId}, ${product},
             ${authorization.effectOperationId}, ${authorization.operationKey}, ${authorization.leaseToken},
             ${observedAt}, 1, ${sql.json(evidenceJson)})
          ON CONFLICT (cohort_id, brawlhalla_id, product) DO NOTHING
          RETURNING effect_operation_id
        `
        if (inserted[0]) return 'applied'
        return (await existingIdentity()) ? 'already-applied' : 'effect-conflict'
      })
    },

    getCohort: () => audit(client),
  }

  return {
    ...tracer,
    async close() {
      await client.end()
    },
  }
}

export type PostgresStatistics = ReturnType<typeof createPostgresStatistics>

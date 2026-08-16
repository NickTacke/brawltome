import { randomUUID } from 'node:crypto'
import { type LegendReference, legendSlug, legends as referenceLegends } from '@brawltome/game-data'
import postgres from 'postgres'
import {
  type CohortCandidateSnapshot,
  LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST,
  LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS,
  type LaunchCohortCapacityEnvelope,
  type LaunchCohortRegion,
  launchCohortBrackets,
  launchCohortRegions,
  selectFullLaunchCohort,
  selectLaunchCohort,
} from './cohort'
import {
  type CareerWeaponHistorySnapshot,
  type LegendMetaHistorySnapshot,
  buildCareerWeaponUsageHistory,
  buildLegendMetaHistory,
} from './history'
import type {
  CareerWeaponUsageFilters,
  CareerWeaponUsageHistoryView,
  CareerWeaponUsageView,
  CohortAudit,
  CohortCollectionIntent,
  CohortMemberAudit,
  CollectionAttemptAuthorization,
  CollectionAttemptPreflightResult,
  CollectionAttemptResult,
  CollectionAuthorization,
  CollectionCommitResult,
  CollectionObservation,
  CollectionPreflightResult,
  CollectionProduct,
  LaunchCellAudit,
  LaunchCohortAudit,
  LegendMetaAvailable,
  LegendMetaHistoryView,
  LegendMetaPublicationAuthorization,
  LegendMetaPublicationCommitResult,
  LegendMetaPublicationDecisionAudit,
  LegendMetaPublicationIntent,
  LegendMetaPublicationReason,
  LegendMetaQueryResult,
  ProductCollectionProgressAudit,
  PublicationAuthorization,
  PublicationCommitResult,
  PublicationDecisionAudit,
  PublicationIntent,
  PublicationStatus,
  StatisticsTracer,
} from './index'
import {
  type LegendMetaArtifact,
  LegendMetaBuildError,
  type LegendMetaCell,
  buildLegendMetaArtifact,
} from './legend-meta'
import {
  type CellCollectionProgress,
  type PublicationDecisionEvidence,
  validatePublicationDecision,
} from './publication'
import { type LifetimeEvidence, validateLifetimeEvidence, validateRankedEvidence } from './source'
import {
  CAREER_WEAPON_USAGE_METHODOLOGY_VERSION,
  type CareerWeaponUsageAggregate,
  CareerWeaponUsageValidationError,
  aggregateCareerWeaponUsage,
  exactRatio,
} from './weapon-usage'

type CohortRow = {
  id: string
  methodology_version: string
  source_snapshot_id: string
  source_generation_id: string
  source_observed_at: Date
  region: LaunchCohortRegion
  bracket: 'Platinum' | 'Diamond+'
  sample_cap: 750
  minimum_evidence_players: 125
  eligible_players: number
  selected_players: number
  evidence_state: 'ready' | 'insufficient-evidence'
}

type GenerationRow = {
  id: string
  methodology_version: string
  source_generation_id: string
  source_observed_at: Date
  observation_window_starts_at: Date
  observation_window_ends_at: Date
  source_domain: 'brawlhalla-v1'
  quota_units_per_window: 150
  quota_window_seconds: 900
  requests_per_player: 2
  max_attempts_per_request: 3
  selected_players: number
  planned_requests: number
  maximum_source_attempts: number
  minimum_capacity_seconds: number
  observation_window_seconds: 604800
  evidence_state: 'ready' | 'insufficient-evidence'
}

type MemberRow = {
  cohort_id: string
  brawlhalla_id: string | number
  source_rating: number
  ordinal: number
  selection_hash: string
  ranked_operation_id: string | null
  lifetime_operation_id: string | null
  ranked_succeeded_at: Date | null
  lifetime_succeeded_at: Date | null
}

type CareerObservationRow = {
  region: LaunchCohortRegion
  bracket: 'Platinum' | 'Diamond+'
  evidence: LifetimeEvidence
}

type CareerScopeAggregate = CareerWeaponUsageAggregate & CareerWeaponUsageFilters

type CareerSnapshotRow = {
  snapshot_id: string
  generation_id: string
  cohort_methodology_version: string
  methodology_version: string
  observation_window_starts_at: Date
  observation_window_ends_at: Date
  published_at: Date
  selected_players: number
  successful_observations: number
  total_held_seconds: string
}

type CareerWeaponRow = {
  weapon: string
  observed_players: number
  held_time_seconds: string
  contributor_count: number
  qualifying_held_seconds: string
  median_damage_numerator: string | null
  median_damage_denominator: string | null
  median_kos_numerator: string | null
  median_kos_denominator: string | null
  comparison_eligible: boolean
  comparison_reasons: CareerWeaponUsageAggregate['rows'][number]['comparison']['reasons']
}

type CareerWeaponHistoryRow = CareerWeaponRow & { snapshot_id: string }

type DecisionRow = {
  id: string
  generation_id: string
  product: CollectionProduct
  effect_operation_id: string
  operation_key: string
  decision: 'accepted' | 'rejected'
  reasons: PublicationDecisionAudit['reasons']
  progress: PublicationDecisionAudit['progress']
  observation_window: PublicationDecisionAudit['observationWindow']
  capacity_envelope: PublicationDecisionAudit['capacityEnvelope']
  decided_at: Date
}

type LegendMetaDecisionRow = {
  id: string
  generation_id: string
  effect_operation_id: string
  operation_key: string
  decision: 'accepted' | 'rejected'
  reasons: LegendMetaPublicationReason[]
  artifact: LegendMetaArtifact | null
  decided_at: Date
}

type LegendMetaSelectionRow = {
  latest_id: string | null
  latest_decision: 'accepted' | 'rejected' | null
  active_id: string | null
  active_artifact: LegendMetaArtifact | null
}

function productFromKind(kind: CollectionAuthorization['kind']): CollectionProduct {
  return kind === 'statistics-ranked-collection' ? 'ranked' : 'lifetime'
}

function kindFromProduct(product: CollectionProduct): CohortCollectionIntent['kind'] {
  return product === 'ranked' ? 'statistics-ranked-collection' : 'statistics-lifetime-collection'
}

function collectionOperationKey(cohortId: string, brawlhallaId: number, product: CollectionProduct): string {
  return `statistics:${cohortId}:${brawlhallaId}:${product}`
}

function publicationOperationKey(generationId: string, product: CollectionProduct): string {
  return `statistics:${generationId}:publication:${product}`
}

function legendMetaPublicationOperationKey(generationId: string): string {
  return `statistics:${generationId}:legend-meta`
}

function capacityEnvelope(row: GenerationRow): LaunchCohortCapacityEnvelope {
  return {
    sourceDomain: row.source_domain,
    quotaUnitsPerWindow: row.quota_units_per_window,
    quotaWindowSeconds: row.quota_window_seconds,
    requestsPerPlayer: row.requests_per_player,
    maxAttemptsPerRequest: row.max_attempts_per_request,
    plannedRequests: row.planned_requests,
    maximumSourceAttempts: row.maximum_source_attempts,
    minimumCapacitySeconds: row.minimum_capacity_seconds,
    observationWindowSeconds: row.observation_window_seconds,
  }
}

function memberAudit(row: MemberRow): CohortMemberAudit {
  return {
    brawlhallaId: Number(row.brawlhalla_id),
    sourceRating: row.source_rating,
    ordinal: row.ordinal,
    selectionHash: row.selection_hash,
    rankedOperationId: row.ranked_operation_id,
    lifetimeOperationId: row.lifetime_operation_id,
    rankedSucceededAt: row.ranked_succeeded_at?.toISOString() ?? null,
    lifetimeSucceededAt: row.lifetime_succeeded_at?.toISOString() ?? null,
  }
}

function decisionAudit(row: DecisionRow): PublicationDecisionAudit {
  return {
    decisionId: row.id,
    generationId: row.generation_id,
    effectOperationId: row.effect_operation_id,
    operationKey: row.operation_key,
    outcome: row.decision,
    reasons: row.reasons,
    progress: row.progress,
    observationWindow: row.observation_window,
    capacityEnvelope: row.capacity_envelope,
    decidedAt: row.decided_at.toISOString(),
  }
}

function legendMetaDecisionAudit(row: LegendMetaDecisionRow): LegendMetaPublicationDecisionAudit {
  return {
    decisionId: row.id,
    generationId: row.generation_id,
    effectOperationId: row.effect_operation_id,
    operationKey: row.operation_key,
    outcome: row.decision,
    reasons: row.reasons,
    decidedAt: row.decided_at.toISOString(),
    snapshotId: row.artifact?.snapshotId ?? null,
  }
}

function summarizeProgress(
  product: CollectionProduct,
  cells: CellCollectionProgress[],
): ProductCollectionProgressAudit {
  return {
    product,
    selectedPlayers: cells.reduce((total, cell) => total + cell.selectedPlayers, 0),
    operations: cells.reduce((total, cell) => total + cell.operations, 0),
    sourceAttempts: cells.reduce((total, cell) => total + cell.sourceAttempts, 0),
    successes: cells.reduce((total, cell) => total + cell.successes, 0),
    cells,
  }
}

function jsonValue(value: unknown): postgres.JSONValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Statistics audit evidence must be JSON serializable')
  try {
    return JSON.parse(serialized) as postgres.JSONValue
  } catch (error) {
    throw new Error('Statistics audit evidence must be valid JSON', { cause: error })
  }
}

const legendMetaReferences = referenceLegends
  .filter(({ heroId, displayName, isActive }) => heroId > 2 && isActive && /\S/u.test(displayName))
  .map(({ heroId, displayName }) => ({
    legendId: heroId,
    name: displayName,
    slug: legendSlug(heroId, displayName),
  }))

function legendMetaBuildFailure(error: unknown): LegendMetaPublicationReason {
  if (error instanceof LegendMetaBuildError) {
    return error.code === 'unknown-legend'
      ? { code: error.code, legendId: error.legendId as number }
      : { code: error.code }
  }
  return { code: 'invalid-ranked-observation' }
}

export function createPostgresStatistics(
  connectionString: string,
  options: {
    now?: () => Date
    legendReferences?: readonly LegendReference[]
  } = {},
) {
  const client = postgres(connectionString)
  const now = options.now ?? (() => new Date())
  const legendReferences =
    options.legendReferences ??
    referenceLegends.map((legend) => ({
      legendId: legend.heroId,
      legendNameKey: legend.heroName,
      bioName: legend.displayName,
      weaponOne: legend.weaponOne,
      weaponTwo: legend.weaponTwo,
    }))

  async function members(sql: typeof client, cohortIds: readonly string[]): Promise<MemberRow[]> {
    if (cohortIds.length === 0) return []
    return sql<MemberRow[]>`
      SELECT member.cohort_id, member.brawlhalla_id, member.source_rating, member.ordinal,
             member.selection_hash, ranked.operation_id AS ranked_operation_id,
             lifetime.operation_id AS lifetime_operation_id,
             ranked_observed.observed_at AS ranked_succeeded_at,
             lifetime_observed.observed_at AS lifetime_succeeded_at
      FROM statistics.cohort_members member
      LEFT JOIN statistics.collection_operations ranked
        ON ranked.cohort_id = member.cohort_id
       AND ranked.brawlhalla_id = member.brawlhalla_id AND ranked.product = 'ranked'
      LEFT JOIN statistics.collection_operations lifetime
        ON lifetime.cohort_id = member.cohort_id
       AND lifetime.brawlhalla_id = member.brawlhalla_id AND lifetime.product = 'lifetime'
      LEFT JOIN statistics.observations ranked_observed
        ON ranked_observed.cohort_id = member.cohort_id
       AND ranked_observed.brawlhalla_id = member.brawlhalla_id AND ranked_observed.product = 'ranked'
      LEFT JOIN statistics.observations lifetime_observed
        ON lifetime_observed.cohort_id = member.cohort_id
       AND lifetime_observed.brawlhalla_id = member.brawlhalla_id AND lifetime_observed.product = 'lifetime'
      WHERE member.cohort_id IN ${sql(cohortIds)}
      ORDER BY member.cohort_id, member.ordinal
    `
  }

  async function auditLegacy(sql: typeof client): Promise<CohortAudit | null> {
    const [cohort] = await sql<CohortRow[]>`
      SELECT id, methodology_version, source_snapshot_id, source_generation_id, source_observed_at,
             region, bracket, sample_cap, minimum_evidence_players, eligible_players,
             selected_players, evidence_state
      FROM statistics.cohorts WHERE tracer_key = 'eu-diamond-plus'
    `
    if (!cohort) return null
    const rows = await members(sql, [cohort.id])
    return {
      cohortId: cohort.id,
      methodologyVersion: cohort.methodology_version,
      sourceSnapshotId: cohort.source_snapshot_id,
      sourceGenerationId: cohort.source_generation_id,
      sourceObservedAt: cohort.source_observed_at.toISOString(),
      region: 'EU',
      bracket: 'Diamond+',
      cap: cohort.sample_cap,
      minimumEvidencePlayers: cohort.minimum_evidence_players,
      eligiblePlayers: cohort.eligible_players,
      selectedPlayers: cohort.selected_players,
      state: cohort.evidence_state,
      members: rows.map(memberAudit),
    }
  }

  async function auditLaunch(sql: typeof client, generationId?: string): Promise<LaunchCohortAudit | null> {
    const [generation] = await sql<GenerationRow[]>`
      SELECT * FROM statistics.cohort_generations
      WHERE (${generationId ?? null}::uuid IS NULL OR id = ${generationId ?? null})
      ORDER BY created_at DESC, id DESC LIMIT 1
    `
    if (!generation) return null
    const cells = await sql<CohortRow[]>`
      SELECT id, methodology_version, source_snapshot_id, source_generation_id, source_observed_at,
             region, bracket, sample_cap, minimum_evidence_players, eligible_players,
             selected_players, evidence_state
      FROM statistics.cohorts WHERE generation_id = ${generation.id}
      ORDER BY array_position(${launchCohortRegions}::text[], region),
               array_position(${launchCohortBrackets}::text[], bracket)
    `
    const allMembers = await members(
      sql,
      cells.map(({ id }) => id),
    )
    const byCohort = new Map<string, CohortMemberAudit[]>()
    for (const row of allMembers) {
      const current = byCohort.get(row.cohort_id) ?? []
      current.push(memberAudit(row))
      byCohort.set(row.cohort_id, current)
    }
    const decisions = await sql<DecisionRow[]>`
      SELECT id, generation_id, product, effect_operation_id, operation_key, decision,
             reasons, progress, observation_window, capacity_envelope, decided_at
      FROM statistics.publication_decisions
      WHERE generation_id = ${generation.id}
      ORDER BY product
    `
    const rankedProgress = await collectionProgress(sql, generation.id, 'ranked')
    const lifetimeProgress = await collectionProgress(sql, generation.id, 'lifetime')
    return {
      generationId: generation.id,
      methodologyVersion: generation.methodology_version,
      sourceGenerationId: generation.source_generation_id,
      sourceObservedAt: generation.source_observed_at.toISOString(),
      observationWindow: {
        startsAt: generation.observation_window_starts_at.toISOString(),
        endsAt: generation.observation_window_ends_at.toISOString(),
      },
      capacityEnvelope: capacityEnvelope(generation),
      selectedPlayers: generation.selected_players,
      state: generation.evidence_state,
      cells: cells.map(
        (cell): LaunchCellAudit => ({
          cohortId: cell.id,
          sourceSnapshotId: cell.source_snapshot_id,
          region: cell.region,
          bracket: cell.bracket,
          cap: cell.sample_cap,
          minimumEvidencePlayers: cell.minimum_evidence_players,
          eligiblePlayers: cell.eligible_players,
          selectedPlayers: cell.selected_players,
          state: cell.evidence_state,
          members: byCohort.get(cell.id) ?? [],
        }),
      ),
      progress: {
        ranked: summarizeProgress('ranked', rankedProgress),
        lifetime: summarizeProgress('lifetime', lifetimeProgress),
      },
      decisions: decisions.map(decisionAudit),
    }
  }

  async function collectionProgress(
    sql: typeof client,
    generationId: string,
    product: CollectionProduct,
  ): Promise<CellCollectionProgress[]> {
    const rows = await sql<
      {
        region: LaunchCohortRegion
        bracket: 'Platinum' | 'Diamond+'
        selected_players: number
        operations: string | number
        source_attempts: string | number
        maximum_player_attempts: string | number
        successes: string | number
        first_attempt_at: Date | null
        last_completed_at: Date | null
      }[]
    >`
      SELECT cohort.region, cohort.bracket, cohort.selected_players,
             count(DISTINCT collection.operation_id)::bigint AS operations,
             coalesce(sum(attempt.attempt_count), 0)::bigint AS source_attempts,
             coalesce(max(attempt.attempt_count), 0)::bigint AS maximum_player_attempts,
             count(DISTINCT observation.effect_operation_id)::bigint AS successes,
             min(attempt.first_attempt_at) AS first_attempt_at,
             max(lineage.completed_at) AS last_completed_at
      FROM statistics.cohorts cohort
      LEFT JOIN statistics.cohort_members member ON member.cohort_id = cohort.id
      LEFT JOIN statistics.collection_operations collection
        ON collection.cohort_id = member.cohort_id
       AND collection.brawlhalla_id = member.brawlhalla_id AND collection.product = ${product}
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS attempt_count, min(source_attempt.attempted_at) AS first_attempt_at
        FROM statistics.collection_attempts source_attempt
        WHERE source_attempt.cohort_id = member.cohort_id
          AND source_attempt.brawlhalla_id = member.brawlhalla_id
          AND source_attempt.product = ${product}
      ) attempt ON true
      LEFT JOIN statistics.observations observation
        ON observation.cohort_id = member.cohort_id
       AND observation.brawlhalla_id = member.brawlhalla_id AND observation.product = ${product}
      LEFT JOIN LATERAL (
        SELECT max(operation.completed_at) AS completed_at
        FROM refresh_operations.operations operation
        WHERE operation.effect_operation_id = collection.operation_id
          AND operation.status IN ('succeeded', 'dead_letter')
      ) lineage ON true
      WHERE cohort.generation_id = ${generationId}
      GROUP BY cohort.id, cohort.region, cohort.bracket, cohort.selected_players
      ORDER BY array_position(${launchCohortRegions}::text[], cohort.region),
               array_position(${launchCohortBrackets}::text[], cohort.bracket)
    `
    return rows.map((row) => ({
      region: row.region,
      bracket: row.bracket,
      selectedPlayers: row.selected_players,
      operations: Number(row.operations),
      sourceAttempts: Number(row.source_attempts),
      maximumPlayerAttempts: Number(row.maximum_player_attempts),
      successes: Number(row.successes),
      firstAttemptAt: row.first_attempt_at?.toISOString() ?? null,
      lastCompletedAt: row.last_completed_at?.toISOString() ?? null,
    }))
  }

  async function careerScopeAggregates(sql: typeof client, generationId: string): Promise<CareerScopeAggregate[]> {
    const [duplicatePlayer] = await sql<{ brawlhalla_id: string }[]>`
      SELECT member.brawlhalla_id
      FROM statistics.cohort_members member
      JOIN statistics.cohorts cohort ON cohort.id = member.cohort_id
      WHERE cohort.generation_id = ${generationId}
      GROUP BY member.brawlhalla_id
      HAVING count(*) > 1
      ORDER BY member.brawlhalla_id
      LIMIT 1
    `
    if (duplicatePlayer) {
      const brawlhallaId = Number(duplicatePlayer.brawlhalla_id)
      if (!Number.isSafeInteger(brawlhallaId)) throw new Error('Career Weapon Usage duplicate player ID is unsafe')
      throw new CareerWeaponUsageValidationError('duplicate-player', brawlhallaId)
    }
    const cells = await sql<
      { region: LaunchCohortRegion; bracket: 'Platinum' | 'Diamond+'; selected_players: number }[]
    >`
      SELECT region, bracket, selected_players
      FROM statistics.cohorts
      WHERE generation_id = ${generationId}
    `
    const observations = await sql<CareerObservationRow[]>`
      SELECT cohort.region, cohort.bracket, observation.evidence
      FROM statistics.observations observation
      JOIN statistics.cohorts cohort ON cohort.id = observation.cohort_id
      WHERE cohort.generation_id = ${generationId} AND observation.product = 'lifetime'
      ORDER BY cohort.region, cohort.bracket, observation.brawlhalla_id
    `
    const regionScopes = ['all', ...launchCohortRegions] as const
    const bracketScopes = ['all', ...launchCohortBrackets] as const
    return regionScopes.flatMap((region) =>
      bracketScopes.map((bracket) => {
        const matches = (value: { region: LaunchCohortRegion; bracket: 'Platinum' | 'Diamond+' }) =>
          (region === 'all' || value.region === region) && (bracket === 'all' || value.bracket === bracket)
        return {
          region,
          bracket,
          ...aggregateCareerWeaponUsage({
            selectedPlayers: cells.filter(matches).reduce((total, cell) => total + cell.selected_players, 0),
            observations: observations.filter(matches).map(({ evidence }) => evidence),
            legendReferences,
          }),
        }
      }),
    )
  }

  async function materializeCareerWeaponUsage(
    sql: typeof client,
    generationId: string,
    decision: DecisionRow,
    scopes: readonly CareerScopeAggregate[],
  ): Promise<void> {
    const snapshotId = randomUUID()
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO statistics.career_weapon_usage_snapshots
        (id, generation_id, cohort_methodology_version, methodology_version,
         publication_decision_id, published_at)
      SELECT ${snapshotId}, ${generationId}, generation.methodology_version,
             ${CAREER_WEAPON_USAGE_METHODOLOGY_VERSION}, decision.id, decision.decided_at
      FROM statistics.publication_decisions decision
      JOIN statistics.cohort_generations generation ON generation.id = decision.generation_id
      WHERE decision.id = ${decision.id} AND generation.id = ${generationId}
      RETURNING id
    `
    if (!inserted[0]) throw new Error('Career Weapon Usage publication decision disappeared')
    await sql`
      INSERT INTO statistics.career_weapon_usage_scopes
        (snapshot_id, region, bracket, selected_players, successful_observations, total_held_seconds)
      SELECT ${snapshotId}, scope.*
      FROM jsonb_to_recordset(${sql.json(
        jsonValue(
          scopes.map((scope) => ({
            region: scope.region,
            bracket: scope.bracket,
            selected_players: scope.selectedPlayers,
            successful_observations: scope.successfulObservations,
            total_held_seconds: scope.totalHeldSeconds,
          })),
        ),
      )}) AS scope(
        region text,
        bracket text,
        selected_players integer,
        successful_observations integer,
        total_held_seconds numeric
      )
    `
    await sql`
      INSERT INTO statistics.career_weapon_usage_rows
        (snapshot_id, region, bracket, weapon, observed_players, held_time_seconds,
         contributor_count, qualifying_held_seconds, median_damage_numerator,
         median_damage_denominator, median_kos_numerator, median_kos_denominator,
         comparison_eligible, comparison_reasons)
      SELECT ${snapshotId}, row.*
      FROM jsonb_to_recordset(${sql.json(
        jsonValue(
          scopes.flatMap((scope) =>
            scope.rows.map((row) => ({
              region: scope.region,
              bracket: scope.bracket,
              weapon: row.weapon,
              observed_players: row.observedPlayers,
              held_time_seconds: row.heldTimeSeconds,
              contributor_count: row.contributorCount,
              qualifying_held_seconds: row.qualifyingHeldSeconds,
              median_damage_numerator: row.medianDamagePerMinute?.numerator ?? null,
              median_damage_denominator: row.medianDamagePerMinute?.denominator ?? null,
              median_kos_numerator: row.medianKosPerHour?.numerator ?? null,
              median_kos_denominator: row.medianKosPerHour?.denominator ?? null,
              comparison_eligible: row.comparison.eligible,
              comparison_reasons: row.comparison.reasons,
            })),
          ),
        ),
      )}) AS row(
        region text,
        bracket text,
        weapon text,
        observed_players integer,
        held_time_seconds numeric,
        contributor_count integer,
        qualifying_held_seconds numeric,
        median_damage_numerator numeric,
        median_damage_denominator numeric,
        median_kos_numerator numeric,
        median_kos_denominator numeric,
        comparison_eligible boolean,
        comparison_reasons jsonb
      )
    `
    await sql`
      UPDATE statistics.career_weapon_usage_snapshots
      SET sealed_at = clock_timestamp()
      WHERE id = ${snapshotId} AND sealed_at IS NULL
    `
  }

  async function inspectCollectionAttempt(
    sql: typeof client,
    authorization: CollectionAttemptAuthorization,
  ): Promise<CollectionAttemptPreflightResult | 'already-recorded'> {
    if (!Number.isSafeInteger(authorization.attemptNumber) || authorization.attemptNumber < 1) {
      throw new Error('Statistics source attempt requires a positive attempt number')
    }
    const product = productFromKind(authorization.kind)
    const [bound] = await sql<{ operation_id: string }[]>`
      SELECT operation_id FROM statistics.collection_operations
      WHERE cohort_id = ${authorization.cohortId} AND brawlhalla_id = ${authorization.brawlhallaId}
        AND product = ${product}
    `
    if (bound?.operation_id !== authorization.effectOperationId) return 'effect-conflict'
    const [operation] = await sql<{ matches: boolean }[]>`
      SELECT effect_operation_id = ${authorization.effectOperationId}
         AND operation_key = ${authorization.operationKey}
         AND kind = ${authorization.kind} AS matches
      FROM refresh_operations.operations WHERE id = ${authorization.operationId}
    `
    if (!operation?.matches) return 'effect-conflict'
    const [existing] = await sql<{ matches: boolean }[]>`
      SELECT effect_operation_id = ${authorization.effectOperationId}
         AND lease_token = ${authorization.leaseToken} AS matches
      FROM statistics.collection_attempts
      WHERE operation_id = ${authorization.operationId} AND attempt_number = ${authorization.attemptNumber}
    `
    if (existing) return existing.matches ? 'already-recorded' : 'effect-conflict'
    const [capacity] = await sql<{ attempts: number }[]>`
      SELECT count(*)::integer AS attempts
      FROM statistics.collection_attempts
      WHERE cohort_id = ${authorization.cohortId}
        AND brawlhalla_id = ${authorization.brawlhallaId}
        AND product = ${product}
    `
    if ((capacity?.attempts ?? 0) >= LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST) return 'capacity-exceeded'
    const [active] = await sql<{ active: boolean }[]>`
      SELECT refresh_operations.acquire_active_lease(
        ${authorization.operationId}, ${authorization.leaseOwner}, ${authorization.leaseToken}
      ) AS active
    `
    return active?.active ? 'allowed' : 'lease-lost'
  }

  const tracer: StatisticsTracer = {
    async reconcileCohort(snapshot): Promise<CohortAudit> {
      const selected = selectLaunchCohort(snapshot)
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(hashtext('statistics:eu-diamond-plus'))`
        const existing = await auditLegacy(sql)
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
            )}
          `
        }
        const created = await auditLegacy(sql)
        if (!created) throw new Error('statistics cohort disappeared during reconciliation')
        return created
      })
    },

    async reconcileLaunchCohort(snapshots): Promise<LaunchCohortAudit> {
      const selected = selectFullLaunchCohort(snapshots)
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${selected.methodologyVersion}, 210))`
        const [existing] = await sql<{ id: string }[]>`
          SELECT id FROM statistics.cohort_generations
          WHERE methodology_version = ${selected.methodologyVersion}
            AND source_generation_id = ${selected.sourceGenerationId}
        `
        if (existing) {
          const found = await auditLaunch(sql, existing.id)
          if (!found) throw new Error('Statistics launch cohort disappeared')
          return found
        }
        const [unfinished] = await sql<{ id: string }[]>`
          SELECT generation.id FROM statistics.cohort_generations generation
          WHERE (SELECT count(*) FROM statistics.publication_decisions decision
                 WHERE decision.generation_id = generation.id) < 2
          ORDER BY generation.created_at DESC LIMIT 1
        `
        if (unfinished) {
          const active = await auditLaunch(sql, unfinished.id)
          if (!active) throw new Error('active Statistics launch cohort disappeared')
          return active
        }

        const generationId = randomUUID()
        const startsAt = new Date()
        const endsAt = new Date(startsAt.getTime() + LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS * 1_000)
        const envelope = selected.capacityEnvelope
        await sql`
          INSERT INTO statistics.cohort_generations
            (id, methodology_version, source_generation_id, source_observed_at,
             observation_window_starts_at, observation_window_ends_at, source_domain,
             quota_units_per_window, quota_window_seconds, requests_per_player,
             max_attempts_per_request, selected_players, planned_requests, maximum_source_attempts,
             minimum_capacity_seconds, observation_window_seconds, evidence_state)
          VALUES (${generationId}, ${selected.methodologyVersion}, ${selected.sourceGenerationId},
            ${selected.sourceObservedAt}, ${startsAt}, ${endsAt}, ${envelope.sourceDomain},
            ${envelope.quotaUnitsPerWindow}, ${envelope.quotaWindowSeconds}, ${envelope.requestsPerPlayer},
            ${envelope.maxAttemptsPerRequest}, ${selected.selectedPlayers}, ${envelope.plannedRequests},
            ${envelope.maximumSourceAttempts}, ${envelope.minimumCapacitySeconds},
            ${envelope.observationWindowSeconds}, ${selected.state})
        `
        for (const cell of selected.cells) {
          const cohortId = randomUUID()
          await sql`
            INSERT INTO statistics.cohorts
              (id, generation_id, tracer_key, methodology_version, source_snapshot_id,
               source_generation_id, source_observed_at, region, bracket, sample_cap,
               minimum_evidence_players, eligible_players, selected_players, evidence_state)
            VALUES (${cohortId}, ${generationId}, ${`${generationId}:${cell.region}:${cell.bracket}`},
              ${selected.methodologyVersion}, ${cell.source.snapshotId}, ${selected.sourceGenerationId},
              ${selected.sourceObservedAt}, ${cell.region}, ${cell.bracket}, ${cell.cap},
              ${cell.minimumEvidencePlayers}, ${cell.eligiblePlayers}, ${cell.selectedPlayers}, ${cell.state})
          `
          for (let offset = 0; offset < cell.members.length; offset += 500) {
            const batch = cell.members.slice(offset, offset + 500)
            await sql`
              INSERT INTO statistics.cohort_members ${sql(
                batch.map((member) => ({
                  cohort_id: cohortId,
                  brawlhalla_id: member.brawlhallaId,
                  ordinal: member.ordinal,
                  source_rating: member.sourceRating,
                  selection_hash: member.selectionHash,
                })),
              )}
            `
          }
        }
        const created = await auditLaunch(sql, generationId)
        if (!created) throw new Error('Statistics launch cohort disappeared during reconciliation')
        return created
      })
    },

    async reconciliationState() {
      const [legacy, launch] = await Promise.all([
        client<{ exists: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM statistics.cohorts WHERE generation_id IS NULL
          ) AS exists
        `,
        client<
          {
            generation_id: string
            source_generation_id: string
            decision_count: string | number
            cohort_ids: string[]
          }[]
        >`
          SELECT generation.id AS generation_id, generation.source_generation_id,
                 (SELECT count(*)::bigint FROM statistics.publication_decisions decision
                  WHERE decision.generation_id = generation.id) AS decision_count,
                 ARRAY(SELECT cohort.id FROM statistics.cohorts cohort
                       WHERE cohort.generation_id = generation.id ORDER BY cohort.id) AS cohort_ids
          FROM statistics.cohort_generations generation
          ORDER BY generation.created_at DESC, generation.id DESC
          LIMIT 1
        `,
      ])
      const current = launch[0]
      return {
        legacyCohortExists: legacy[0]?.exists ?? false,
        launch: current
          ? {
              generationId: current.generation_id,
              sourceGenerationId: current.source_generation_id,
              decisionCount: Number(current.decision_count),
              cohortIds: current.cohort_ids,
            }
          : null,
      }
    },

    async collectionIntents(limit = 500): Promise<CohortCollectionIntent[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('Statistics collection intent limit must be an integer between 1 and 500')
      }
      const rows = await client<{ cohort_id: string; brawlhalla_id: string | number; product: CollectionProduct }[]>`
        SELECT member.cohort_id, member.brawlhalla_id, product.product
        FROM statistics.cohort_members member
        JOIN statistics.cohorts cohort ON cohort.id = member.cohort_id
        LEFT JOIN statistics.cohort_generations generation ON generation.id = cohort.generation_id
        CROSS JOIN (VALUES ('ranked'::text), ('lifetime'::text)) product(product)
        LEFT JOIN statistics.collection_operations operation
          ON operation.cohort_id = member.cohort_id
         AND operation.brawlhalla_id = member.brawlhalla_id AND operation.product = product.product
        WHERE operation.operation_id IS NULL
          AND (cohort.generation_id IS NULL OR generation.evidence_state = 'ready')
        ORDER BY cohort.created_at, member.cohort_id, member.ordinal, product.product DESC
        LIMIT ${limit}
      `
      return rows.map((row) => {
        const brawlhallaId = Number(row.brawlhalla_id)
        return {
          cohortId: row.cohort_id,
          brawlhallaId,
          product: row.product,
          kind: kindFromProduct(row.product),
          operationKey: collectionOperationKey(row.cohort_id, brawlhallaId, row.product),
        }
      })
    },

    async boundCollectionOperationIds(operationIds): Promise<string[]> {
      if (operationIds.length > 500)
        throw new Error('Statistics collection binding lookup is limited to 500 operations')
      if (operationIds.length === 0) return []
      const rows = await client<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.collection_operations
        WHERE operation_id = ANY(${operationIds}::uuid[])
        ORDER BY operation_id
      `
      return rows.map(({ operation_id }) => operation_id)
    },

    async recordCollectionOperation(intent, operationId): Promise<void> {
      if (
        intent.kind !== kindFromProduct(intent.product) ||
        intent.operationKey !== collectionOperationKey(intent.cohortId, intent.brawlhallaId, intent.product)
      ) {
        throw new Error('collection intent does not match the fixed operation identity')
      }
      await client`
        INSERT INTO statistics.collection_operations (cohort_id, brawlhalla_id, product, operation_id)
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

    async preflightCollectionAttempt(authorization): Promise<CollectionAttemptPreflightResult> {
      return client.begin(async (transaction) => {
        const result = await inspectCollectionAttempt(transaction as unknown as typeof client, authorization)
        return result === 'already-recorded' ? 'allowed' : result
      })
    },

    async recordCollectionAttempt(authorization): Promise<CollectionAttemptResult> {
      const product = productFromKind(authorization.kind)
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const inspected = await inspectCollectionAttempt(sql, authorization)
        if (inspected !== 'allowed') return inspected
        await sql`
          INSERT INTO statistics.collection_attempts
            (cohort_id, brawlhalla_id, product, operation_id, effect_operation_id,
             attempt_number, lease_token)
          VALUES (${authorization.cohortId}, ${authorization.brawlhallaId}, ${product},
            ${authorization.operationId}, ${authorization.effectOperationId}, ${authorization.attemptNumber},
            ${authorization.leaseToken})
        `
        return 'recorded'
      })
    },

    async preflightCollection(authorization): Promise<CollectionPreflightResult> {
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
               effect.operation_key AS effect_operation_key, effect.kind AS effect_kind
        FROM statistics.collection_operations collection
        LEFT JOIN statistics.observations observation
          ON observation.cohort_id = collection.cohort_id
         AND observation.brawlhalla_id = collection.brawlhalla_id AND observation.product = collection.product
        LEFT JOIN refresh_operations.statistics_collection_effects effect
          ON effect.operation_id = ${authorization.effectOperationId}
          OR effect.operation_key = ${authorization.operationKey}
        WHERE collection.cohort_id = ${authorization.cohortId}
          AND collection.brawlhalla_id = ${authorization.brawlhallaId} AND collection.product = ${product}
      `
      if (
        identities.length === 0 ||
        identities.some((row) => row.bound_operation_id !== authorization.effectOperationId)
      ) {
        return 'effect-conflict'
      }
      const observations = identities.filter((row) => row.observation_effect_operation_id !== null)
      const effects = identities.filter((row) => row.effect_operation_id !== null)
      if (observations.length === 0 && effects.length === 0) return 'missing'
      if (
        observations.length === 1 &&
        effects.length === 1 &&
        observations[0]?.observation_effect_operation_id === authorization.effectOperationId &&
        observations[0]?.observation_operation_key === authorization.operationKey &&
        effects[0]?.effect_operation_id === authorization.effectOperationId &&
        effects[0]?.effect_operation_key === authorization.operationKey &&
        effects[0]?.effect_kind === authorization.kind
      )
        return 'already-applied'
      return 'effect-conflict'
    },

    async commitObservation(observation): Promise<CollectionCommitResult> {
      const { authorization } = observation
      const product = productFromKind(authorization.kind)
      const observedAt = observation.observedAt ?? new Date()
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [bound] = await sql<{ operation_id: string }[]>`
          SELECT operation_id FROM statistics.collection_operations
          WHERE cohort_id = ${authorization.cohortId} AND brawlhalla_id = ${authorization.brawlhallaId}
            AND product = ${product} FOR SHARE
        `
        if (bound?.operation_id !== authorization.effectOperationId) return 'effect-conflict'
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
              AND brawlhalla_id = ${authorization.brawlhallaId} AND product = ${product}
          `
          return existing?.matches === true
        }
        if (result === 'already-applied') return (await existingIdentity()) ? 'already-applied' : 'effect-conflict'
        const evidence =
          authorization.kind === 'statistics-ranked-collection'
            ? validateRankedEvidence(observation.evidence, authorization.brawlhallaId)
            : validateLifetimeEvidence(observation.evidence, authorization.brawlhallaId)
        const inserted = await sql<{ effect_operation_id: string }[]>`
          INSERT INTO statistics.observations
            (cohort_id, brawlhalla_id, product, effect_operation_id, operation_key,
             lease_token, observed_at, evidence_version, evidence)
          VALUES (${authorization.cohortId}, ${authorization.brawlhallaId}, ${product},
            ${authorization.effectOperationId}, ${authorization.operationKey}, ${authorization.leaseToken},
            ${observedAt}, 1, ${sql.json(jsonValue(evidence))})
          ON CONFLICT (cohort_id, brawlhalla_id, product) DO NOTHING RETURNING effect_operation_id
        `
        if (inserted[0]) return 'applied'
        return (await existingIdentity()) ? 'already-applied' : 'effect-conflict'
      })
    },

    async publicationIntents(): Promise<PublicationIntent[]> {
      const rows = await client<{ generation_id: string; product: CollectionProduct }[]>`
        SELECT generation.id AS generation_id, product.product
        FROM statistics.cohort_generations generation
        CROSS JOIN (VALUES ('ranked'::text), ('lifetime'::text)) product(product)
        LEFT JOIN statistics.publication_operations publication
          ON publication.generation_id = generation.id AND publication.product = product.product
        WHERE publication.operation_id IS NULL
          AND (generation.evidence_state = 'insufficient-evidence' OR NOT EXISTS (
            SELECT 1 FROM statistics.cohorts cohort
            JOIN statistics.cohort_members member ON member.cohort_id = cohort.id
            LEFT JOIN statistics.collection_operations collection
              ON collection.cohort_id = member.cohort_id
             AND collection.brawlhalla_id = member.brawlhalla_id AND collection.product = product.product
            WHERE cohort.generation_id = generation.id
              AND (collection.operation_id IS NULL OR EXISTS (
                SELECT 1 FROM refresh_operations.operations operation
                WHERE operation.effect_operation_id = collection.operation_id
                  AND operation.status NOT IN ('succeeded', 'dead_letter')
              ) OR NOT EXISTS (
                SELECT 1 FROM refresh_operations.operations operation
                WHERE operation.effect_operation_id = collection.operation_id
                  AND operation.status IN ('succeeded', 'dead_letter')
              ))
          ))
        ORDER BY generation.created_at, product.product DESC
      `
      return rows.map(({ generation_id, product }) => ({
        generationId: generation_id,
        product,
        kind: 'statistics-publication',
        operationKey: publicationOperationKey(generation_id, product),
      }))
    },

    async boundPublicationOperationIds(operationIds): Promise<string[]> {
      if (operationIds.length > 100)
        throw new Error('Statistics publication binding lookup is limited to 100 operations')
      if (operationIds.length === 0) return []
      const rows = await client<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.publication_operations
        WHERE operation_id = ANY(${operationIds}::uuid[])
        ORDER BY operation_id
      `
      return rows.map(({ operation_id }) => operation_id)
    },

    async recordPublicationOperation(intent, operationId): Promise<'recorded' | 'collection-active'> {
      if (
        intent.kind !== 'statistics-publication' ||
        intent.operationKey !== publicationOperationKey(intent.generationId, intent.product)
      ) {
        throw new Error('publication intent does not match the fixed operation identity')
      }
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [existingBinding] = await sql<{ operation_id: string }[]>`
          SELECT operation_id FROM statistics.publication_operations
          WHERE generation_id = ${intent.generationId} AND product = ${intent.product}
        `
        if (existingBinding) {
          if (existingBinding.operation_id !== operationId) throw new Error('publication operation identity conflicts')
          return 'recorded'
        }
        const [seal] = await sql<{ result: 'sealed' | 'collection-active' | 'effect-conflict' }[]>`
          SELECT refresh_operations.seal_statistics_collections_for_publication(
            ${operationId},
            ARRAY(
              SELECT collection.operation_id
              FROM statistics.collection_operations collection
              JOIN statistics.cohorts cohort ON cohort.id = collection.cohort_id
              WHERE cohort.generation_id = ${intent.generationId}
                AND collection.product = ${intent.product}
              ORDER BY collection.operation_id
            )
          ) AS result
        `
        if (seal?.result === 'collection-active') return 'collection-active'
        if (seal?.result !== 'sealed') throw new Error('publication collection seal conflicts')
        await sql`
          INSERT INTO statistics.publication_operations (generation_id, product, operation_id)
          VALUES (${intent.generationId}, ${intent.product}, ${operationId})
          ON CONFLICT (generation_id, product) DO NOTHING
        `
        const [recorded] = await sql<{ operation_id: string }[]>`
          SELECT operation_id FROM statistics.publication_operations
          WHERE generation_id = ${intent.generationId} AND product = ${intent.product}
        `
        if (recorded?.operation_id !== operationId) throw new Error('publication operation identity conflicts')
        return 'recorded'
      })
    },

    async preflightPublication(authorization): Promise<CollectionPreflightResult> {
      const [identity] = await client<
        {
          bound_operation_id: string
          decision_effect_operation_id: string | null
          decision_operation_key: string | null
          effect_operation_id: string | null
          effect_operation_key: string | null
        }[]
      >`
        SELECT publication.operation_id AS bound_operation_id,
               decision.effect_operation_id AS decision_effect_operation_id,
               decision.operation_key AS decision_operation_key,
               effect.operation_id AS effect_operation_id, effect.operation_key AS effect_operation_key
        FROM statistics.publication_operations publication
        LEFT JOIN statistics.publication_decisions decision
          ON decision.generation_id = publication.generation_id AND decision.product = publication.product
        LEFT JOIN refresh_operations.statistics_publication_effects effect
          ON effect.operation_id = ${authorization.effectOperationId}
          OR effect.operation_key = ${authorization.operationKey}
        WHERE publication.generation_id = ${authorization.generationId}
          AND publication.product = ${authorization.product}
      `
      if (!identity || identity.bound_operation_id !== authorization.effectOperationId) return 'effect-conflict'
      if (!identity.decision_effect_operation_id && !identity.effect_operation_id) return 'missing'
      return identity.decision_effect_operation_id === authorization.effectOperationId &&
        identity.decision_operation_key === authorization.operationKey &&
        identity.effect_operation_id === authorization.effectOperationId &&
        identity.effect_operation_key === authorization.operationKey
        ? 'already-applied'
        : 'effect-conflict'
    },

    async validateAndPublish(authorization): Promise<{
      result: PublicationCommitResult
      decision: PublicationDecisionAudit | null
    }> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [bound] = await sql<{ operation_id: string }[]>`
          SELECT operation_id FROM statistics.publication_operations
          WHERE generation_id = ${authorization.generationId} AND product = ${authorization.product} FOR SHARE
        `
        if (bound?.operation_id !== authorization.effectOperationId)
          return { result: 'effect-conflict', decision: null }
        const [effect] = await sql<{ result: PublicationCommitResult }[]>`
          SELECT refresh_operations.record_statistics_publication_effect(
            ${authorization.operationId}, ${authorization.operationKey},
            ${authorization.leaseOwner}, ${authorization.leaseToken},
            ARRAY(
              SELECT collection.operation_id
              FROM statistics.collection_operations collection
              JOIN statistics.cohorts cohort ON cohort.id = collection.cohort_id
              WHERE cohort.generation_id = ${authorization.generationId}
                AND collection.product = ${authorization.product}
              ORDER BY collection.operation_id
            )
          ) AS result
        `
        const result = effect?.result ?? 'lease-lost'
        const [existing] = await sql<DecisionRow[]>`
          SELECT id, generation_id, product, effect_operation_id, operation_key, decision,
                 reasons, progress, observation_window, capacity_envelope, decided_at
          FROM statistics.publication_decisions
          WHERE generation_id = ${authorization.generationId} AND product = ${authorization.product}
        `
        if (result === 'lease-lost' || result === 'effect-conflict' || result === 'collection-active') {
          return { result, decision: null }
        }
        if (result === 'already-applied') {
          return existing &&
            existing.effect_operation_id === authorization.effectOperationId &&
            existing.operation_key === authorization.operationKey
            ? { result: 'already-applied', decision: decisionAudit(existing) }
            : { result: 'effect-conflict', decision: null }
        }
        if (existing) throw new Error('Statistics publication decision exists without its durable effect')
        const [generation] = await sql<GenerationRow[]>`
          SELECT * FROM statistics.cohort_generations WHERE id = ${authorization.generationId}
        `
        if (!generation) throw new Error('Statistics publication generation disappeared')
        let evidence: PublicationDecisionEvidence = validatePublicationDecision({
          generationId: generation.id,
          product: authorization.product,
          cells: await collectionProgress(sql, generation.id, authorization.product),
          observationWindow: {
            startsAt: generation.observation_window_starts_at.toISOString(),
            endsAt: generation.observation_window_ends_at.toISOString(),
          },
          capacityEnvelope: capacityEnvelope(generation),
        })
        let careerScopes: CareerScopeAggregate[] | null = null
        if (authorization.product === 'lifetime' && evidence.outcome === 'accepted') {
          try {
            careerScopes = await careerScopeAggregates(sql, generation.id)
          } catch (error) {
            if (!(error instanceof CareerWeaponUsageValidationError)) throw error
            evidence = {
              ...evidence,
              outcome: 'rejected',
              reasons: [
                ...evidence.reasons,
                error.code === 'duplicate-player'
                  ? { code: 'career-weapon-duplicate-player', brawlhallaId: error.subjectId }
                  : { code: 'career-weapon-unresolved-legend', legendId: error.subjectId },
              ],
            }
          }
        }
        const decisionId = randomUUID()
        const [inserted] = await sql<DecisionRow[]>`
          INSERT INTO statistics.publication_decisions
            (id, generation_id, product, effect_operation_id, operation_key, lease_token,
             decision, reasons, progress, observation_window, capacity_envelope)
          VALUES (${decisionId}, ${generation.id}, ${authorization.product}, ${authorization.effectOperationId},
            ${authorization.operationKey}, ${authorization.leaseToken}, ${evidence.outcome},
            ${sql.json(jsonValue(evidence.reasons))}, ${sql.json(jsonValue(evidence.progress))},
            ${sql.json(jsonValue(evidence.observationWindow))}, ${sql.json(jsonValue(evidence.capacityEnvelope))})
          RETURNING id, generation_id, product, effect_operation_id, operation_key, decision,
                    reasons, progress, observation_window, capacity_envelope, decided_at
        `
        if (!inserted) throw new Error('Statistics publication decision was not inserted')
        if (careerScopes && evidence.outcome === 'accepted') {
          await materializeCareerWeaponUsage(sql, generation.id, inserted, careerScopes)
        }
        return { result: 'applied', decision: decisionAudit(inserted) }
      })
    },

    async legendMetaPublicationIntents(): Promise<LegendMetaPublicationIntent[]> {
      const rows = await client<{ generation_id: string }[]>`
        SELECT ranked.generation_id
        FROM statistics.publication_decisions ranked
        LEFT JOIN statistics.legend_meta_publication_operations legend_meta
          ON legend_meta.generation_id = ranked.generation_id
        WHERE ranked.product = 'ranked' AND legend_meta.operation_id IS NULL
        ORDER BY ranked.decided_at, ranked.generation_id
      `
      return rows.map(({ generation_id }) => ({
        generationId: generation_id,
        kind: 'statistics-legend-meta-publication',
        operationKey: legendMetaPublicationOperationKey(generation_id),
      }))
    },

    async boundLegendMetaPublicationOperationIds(operationIds): Promise<string[]> {
      if (operationIds.length > 100) {
        throw new Error('Statistics Legend Meta binding lookup is limited to 100 operations')
      }
      if (operationIds.length === 0) return []
      const rows = await client<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.legend_meta_publication_operations
        WHERE operation_id = ANY(${operationIds}::uuid[])
        ORDER BY operation_id
      `
      return rows.map(({ operation_id }) => operation_id)
    },

    async recordLegendMetaPublicationOperation(intent, operationId): Promise<void> {
      if (
        intent.kind !== 'statistics-legend-meta-publication' ||
        intent.operationKey !== legendMetaPublicationOperationKey(intent.generationId)
      ) {
        throw new Error('Legend Meta publication intent does not match the fixed operation identity')
      }
      await client`
        INSERT INTO statistics.legend_meta_publication_operations (generation_id, operation_id)
        VALUES (${intent.generationId}, ${operationId})
        ON CONFLICT (generation_id) DO NOTHING
      `
      const [recorded] = await client<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.legend_meta_publication_operations
        WHERE generation_id = ${intent.generationId}
      `
      if (recorded?.operation_id !== operationId) {
        throw new Error('Legend Meta publication operation identity conflicts')
      }
    },

    async preflightLegendMetaPublication(authorization): Promise<CollectionPreflightResult> {
      const [identity] = await client<
        {
          bound_operation_id: string
          decision_effect_operation_id: string | null
          decision_operation_key: string | null
          effect_operation_id: string | null
          effect_operation_key: string | null
        }[]
      >`
        SELECT publication.operation_id AS bound_operation_id,
               decision.effect_operation_id AS decision_effect_operation_id,
               decision.operation_key AS decision_operation_key,
               effect.operation_id AS effect_operation_id, effect.operation_key AS effect_operation_key
        FROM statistics.legend_meta_publication_operations publication
        LEFT JOIN statistics.legend_meta_publication_decisions decision
          ON decision.generation_id = publication.generation_id
        LEFT JOIN refresh_operations.statistics_legend_meta_publication_effects effect
          ON effect.operation_id = ${authorization.effectOperationId}
          OR effect.operation_key = ${authorization.operationKey}
        WHERE publication.generation_id = ${authorization.generationId}
      `
      if (!identity || identity.bound_operation_id !== authorization.effectOperationId) return 'effect-conflict'
      if (!identity.decision_effect_operation_id && !identity.effect_operation_id) return 'missing'
      return identity.decision_effect_operation_id === authorization.effectOperationId &&
        identity.decision_operation_key === authorization.operationKey &&
        identity.effect_operation_id === authorization.effectOperationId &&
        identity.effect_operation_key === authorization.operationKey
        ? 'already-applied'
        : 'effect-conflict'
    },

    async buildAndPublishLegendMeta(authorization: LegendMetaPublicationAuthorization): Promise<{
      result: LegendMetaPublicationCommitResult
      decision: LegendMetaPublicationDecisionAudit | null
    }> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [bound] = await sql<{ operation_id: string }[]>`
          SELECT operation_id FROM statistics.legend_meta_publication_operations
          WHERE generation_id = ${authorization.generationId} FOR SHARE
        `
        if (bound?.operation_id !== authorization.effectOperationId) {
          return { result: 'effect-conflict', decision: null }
        }
        const [effect] = await sql<{ result: LegendMetaPublicationCommitResult }[]>`
          SELECT refresh_operations.record_statistics_legend_meta_publication_effect(
            ${authorization.operationId}, ${authorization.operationKey},
            ${authorization.leaseOwner}, ${authorization.leaseToken}
          ) AS result
        `
        const result = effect?.result ?? 'lease-lost'
        const [existing] = await sql<LegendMetaDecisionRow[]>`
          SELECT id, generation_id, effect_operation_id, operation_key, decision,
                 reasons, artifact, decided_at
          FROM statistics.legend_meta_publication_decisions
          WHERE generation_id = ${authorization.generationId}
        `
        if (result === 'lease-lost' || result === 'effect-conflict' || result === 'prerequisite-missing') {
          return { result, decision: null }
        }
        if (result === 'already-applied') {
          return existing &&
            existing.effect_operation_id === authorization.effectOperationId &&
            existing.operation_key === authorization.operationKey
            ? { result: 'already-applied', decision: legendMetaDecisionAudit(existing) }
            : { result: 'effect-conflict', decision: null }
        }
        if (existing) throw new Error('Legend Meta decision exists without its durable effect')

        const [rankedDecision] = await sql<{ decision: 'accepted' | 'rejected' }[]>`
          SELECT decision FROM statistics.publication_decisions
          WHERE generation_id = ${authorization.generationId} AND product = 'ranked'
        `
        if (!rankedDecision) return { result: 'prerequisite-missing', decision: null }

        let reasons: LegendMetaPublicationReason[] = []
        let artifact: LegendMetaArtifact | null = null
        if (rankedDecision.decision === 'rejected') {
          reasons = [{ code: 'ranked-publication-rejected' }]
        } else {
          const [generation] = await sql<GenerationRow[]>`
            SELECT * FROM statistics.cohort_generations WHERE id = ${authorization.generationId}
          `
          if (!generation) throw new Error('Legend Meta generation disappeared')
          const cohortRows = await sql<
            {
              id: string
              region: LaunchCohortRegion
              bracket: 'Platinum' | 'Diamond+'
              selected_players: number
            }[]
          >`
            SELECT id, region, bracket, selected_players
            FROM statistics.cohorts WHERE generation_id = ${authorization.generationId}
            ORDER BY region, bracket
          `
          const [duplicateMember] = await sql<{ brawlhalla_id: string | number }[]>`
            SELECT member.brawlhalla_id
            FROM statistics.cohort_members member
            JOIN statistics.cohorts cohort ON cohort.id = member.cohort_id
            WHERE cohort.generation_id = ${authorization.generationId}
            GROUP BY member.brawlhalla_id HAVING count(*) > 1
            LIMIT 1
          `
          const observations = await sql<{ cohort_id: string; brawlhalla_id: string | number; evidence: unknown }[]>`
            SELECT observation.cohort_id, observation.brawlhalla_id, observation.evidence
            FROM statistics.observations observation
            JOIN statistics.cohorts cohort ON cohort.id = observation.cohort_id
            WHERE cohort.generation_id = ${authorization.generationId}
              AND observation.product = 'ranked'
            ORDER BY observation.cohort_id, observation.brawlhalla_id
          `
          try {
            if (duplicateMember) {
              throw new LegendMetaBuildError('duplicate-player-across-cells')
            }
            const observationsByCohort = new Map<string, LegendMetaCell['observations']>()
            for (const row of observations) {
              const brawlhallaId = Number(row.brawlhalla_id)
              const evidence = validateRankedEvidence(row.evidence, brawlhallaId)
              const current = observationsByCohort.get(row.cohort_id) ?? []
              observationsByCohort.set(row.cohort_id, [
                ...current,
                {
                  brawlhallaId,
                  rating: evidence.rating,
                  legends: evidence.legends.map(({ legendId, games, wins }) => ({ legendId, games, wins })),
                },
              ])
            }
            const publishedAt = now().toISOString()
            artifact = buildLegendMetaArtifact({
              snapshotId: randomUUID(),
              generationId: generation.id,
              cohortMethodologyVersion: generation.methodology_version,
              sourceGenerationId: generation.source_generation_id,
              sourceObservedAt: generation.source_observed_at.toISOString(),
              observationWindow: {
                startsAt: generation.observation_window_starts_at.toISOString(),
                endsAt: generation.observation_window_ends_at.toISOString(),
              },
              publishedAt,
              legends: legendMetaReferences,
              cells: cohortRows.map((cohort) => ({
                region: cohort.region,
                bracket: cohort.bracket,
                selectedPlayers: cohort.selected_players,
                observations: observationsByCohort.get(cohort.id) ?? [],
              })),
            })
          } catch (error) {
            reasons = [legendMetaBuildFailure(error)]
          }
        }

        const decision = artifact ? 'accepted' : 'rejected'
        const [inserted] = await sql<LegendMetaDecisionRow[]>`
          INSERT INTO statistics.legend_meta_publication_decisions
            (id, generation_id, effect_operation_id, operation_key, lease_token,
             decision, reasons, artifact)
          VALUES (${randomUUID()}, ${authorization.generationId}, ${authorization.effectOperationId},
            ${authorization.operationKey}, ${authorization.leaseToken}, ${decision},
            ${sql.json(jsonValue(reasons))}, ${artifact ? sql.json(jsonValue(artifact)) : null})
          RETURNING id, generation_id, effect_operation_id, operation_key, decision,
                    reasons, artifact, decided_at
        `
        if (!inserted) throw new Error('Legend Meta publication decision was not inserted')
        return { result: 'applied', decision: legendMetaDecisionAudit(inserted) }
      })
    },

    async getLegendMetaHistory(input): Promise<LegendMetaHistoryView> {
      const publications = await client<{ artifact: LegendMetaArtifact; sequence_at: Date; sequence_id: string }[]>`
        SELECT decision.artifact, generation.created_at AS sequence_at, generation.id AS sequence_id
        FROM statistics.legend_meta_publication_decisions decision
        JOIN statistics.cohort_generations generation ON generation.id = decision.generation_id
        WHERE decision.decision = 'accepted'
        ORDER BY generation.created_at DESC, generation.id DESC
        LIMIT 8
      `
      if (publications.length === 0) {
        return { status: 'unavailable', reason: 'not-yet-published', ...input }
      }
      const snapshots = publications.map(({ artifact, sequence_at, sequence_id }) => {
        const slice = artifact.slices.find(
          ({ region, bracket }) => region === input.region && bracket === input.bracket,
        )
        if (!slice) throw new Error(`Legend Meta artifact is missing ${input.region}/${input.bracket}`)
        return {
          snapshotId: artifact.snapshotId,
          generationId: artifact.generationId,
          publishedAt: artifact.publishedAt,
          observationWindow: artifact.observationWindow,
          sequence: { at: sequence_at.toISOString(), id: sequence_id },
          compatibility: {
            season: { applicability: 'required' as const, identity: artifact.season.identity },
            cohortMethodologyVersion: artifact.cohortMethodologyVersion,
            metricMethodologyVersion: artifact.methodologyVersion,
            scope: input,
          },
          rows: slice.rows.map((row) => ({
            legend: row.legend,
            eligible: row.eligible,
            rank: row.rank,
            medianRating: row.medianRating,
            pickShareBasisPoints: row.pickShare.basisPoints,
            adoptionBasisPoints: row.adoption.basisPoints,
            winRateBasisPoints: row.winRate.basisPoints,
          })),
          data: slice,
        } satisfies LegendMetaHistorySnapshot & { generationId: string; data: typeof slice }
      })
      return { status: 'available', ...input, entries: buildLegendMetaHistory(snapshots) }
    },

    async getLegendMeta(input): Promise<LegendMetaQueryResult> {
      const [selection] = await client<LegendMetaSelectionRow[]>`
        WITH latest AS (
          SELECT decision.id, decision.decision
          FROM statistics.legend_meta_publication_decisions decision
          JOIN statistics.cohort_generations generation ON generation.id = decision.generation_id
          ORDER BY generation.created_at DESC, generation.id DESC
          LIMIT 1
        ), active AS (
          SELECT decision.id, decision.artifact
          FROM statistics.legend_meta_publication_decisions decision
          JOIN statistics.cohort_generations generation ON generation.id = decision.generation_id
          WHERE decision.decision = 'accepted'
          ORDER BY generation.created_at DESC, generation.id DESC
          LIMIT 1
        )
        SELECT latest.id AS latest_id, latest.decision AS latest_decision,
               active.id AS active_id, active.artifact AS active_artifact
        FROM latest FULL OUTER JOIN active ON true
      `
      if (!selection?.active_id) {
        return { status: 'unavailable', reason: 'not-yet-published', ...input }
      }
      if (!selection.active_artifact) throw new Error('accepted Legend Meta publication is missing its artifact')
      const slice = selection.active_artifact.slices.find(
        ({ region, bracket }) => region === input.region && bracket === input.bracket,
      )
      if (!slice) throw new Error(`Legend Meta artifact is missing ${input.region}/${input.bracket}`)
      const latestBuildFailed = selection.latest_decision === 'rejected' && selection.latest_id !== selection.active_id
      const publicationOverdue = now().getTime() > Date.parse(selection.active_artifact.expectedNextPublicationAt)
      const staleReason = latestBuildFailed
        ? ('latest-build-failed' as const)
        : publicationOverdue
          ? ('publication-overdue' as const)
          : null
      const { slices: _slices, ...artifact } = selection.active_artifact
      const result: LegendMetaAvailable = {
        ...artifact,
        status: staleReason ? 'stale' : 'fresh',
        staleReason,
        region: input.region,
        bracket: input.bracket,
        slice,
      }
      return result
    },

    getCohort: () => auditLegacy(client),
    getLaunchCohort: (generationId) => auditLaunch(client, generationId),

    async getCareerWeaponUsageHistory(filters): Promise<CareerWeaponUsageHistoryView> {
      const snapshots = await client<CareerSnapshotRow[]>`
        SELECT snapshot.id AS snapshot_id, snapshot.generation_id,
               snapshot.cohort_methodology_version, snapshot.methodology_version,
               generation.observation_window_starts_at, generation.observation_window_ends_at,
               snapshot.published_at, scope.selected_players, scope.successful_observations,
               scope.total_held_seconds
        FROM statistics.career_weapon_usage_snapshots snapshot
        JOIN statistics.cohort_generations generation ON generation.id = snapshot.generation_id
        JOIN statistics.career_weapon_usage_scopes scope ON scope.snapshot_id = snapshot.id
        WHERE snapshot.sealed_at IS NOT NULL
          AND scope.region = ${filters.region} AND scope.bracket = ${filters.bracket}
        ORDER BY snapshot.published_at DESC, snapshot.id DESC
        LIMIT 8
      `
      if (snapshots.length === 0) {
        return { status: 'unavailable', reason: 'not-yet-published', filters }
      }
      const rows = await client<CareerWeaponHistoryRow[]>`
        SELECT snapshot_id, weapon, observed_players, held_time_seconds, contributor_count,
               qualifying_held_seconds, median_damage_numerator, median_damage_denominator,
               median_kos_numerator, median_kos_denominator, comparison_eligible, comparison_reasons
        FROM statistics.career_weapon_usage_rows
        WHERE snapshot_id = ANY(${snapshots.map(({ snapshot_id }) => snapshot_id)}::uuid[])
          AND region = ${filters.region} AND bracket = ${filters.bracket}
        ORDER BY snapshot_id, weapon
      `
      const historySnapshots = snapshots.map((snapshot) => {
        const snapshotRows = rows.filter(({ snapshot_id }) => snapshot_id === snapshot.snapshot_id)
        const totalHeldSeconds = BigInt(snapshot.total_held_seconds)
        const aggregate: CareerWeaponUsageAggregate = {
          selectedPlayers: snapshot.selected_players,
          successfulObservations: snapshot.successful_observations,
          coverage:
            snapshot.selected_players > 0
              ? exactRatio(BigInt(snapshot.successful_observations), BigInt(snapshot.selected_players))
              : null,
          totalHeldSeconds: snapshot.total_held_seconds,
          rows: snapshotRows.map((row) => ({
            weapon: row.weapon,
            observedPlayers: row.observed_players,
            prevalence:
              snapshot.successful_observations > 0
                ? exactRatio(BigInt(row.observed_players), BigInt(snapshot.successful_observations))
                : null,
            heldTimeSeconds: row.held_time_seconds,
            heldTimeShare: totalHeldSeconds > 0n ? exactRatio(BigInt(row.held_time_seconds), totalHeldSeconds) : null,
            contributorCount: row.contributor_count,
            qualifyingHeldSeconds: row.qualifying_held_seconds,
            medianDamagePerMinute:
              row.median_damage_numerator !== null && row.median_damage_denominator !== null
                ? exactRatio(BigInt(row.median_damage_numerator), BigInt(row.median_damage_denominator))
                : null,
            medianKosPerHour:
              row.median_kos_numerator !== null && row.median_kos_denominator !== null
                ? exactRatio(BigInt(row.median_kos_numerator), BigInt(row.median_kos_denominator))
                : null,
            comparison: { eligible: row.comparison_eligible, reasons: row.comparison_reasons },
          })),
        }
        return {
          snapshotId: snapshot.snapshot_id,
          generationId: snapshot.generation_id,
          publishedAt: snapshot.published_at.toISOString(),
          observationWindow: {
            startsAt: snapshot.observation_window_starts_at.toISOString(),
            endsAt: snapshot.observation_window_ends_at.toISOString(),
          },
          compatibility: {
            season: { applicability: 'not-applicable' as const },
            cohortMethodologyVersion: snapshot.cohort_methodology_version,
            metricMethodologyVersion: snapshot.methodology_version,
            scope: filters,
          },
          rows: aggregate.rows.map((row) => ({
            weapon: row.weapon,
            eligible: row.comparison.eligible,
            prevalence: row.prevalence,
            heldTimeShare: row.heldTimeShare,
            medianDamagePerMinute: row.medianDamagePerMinute,
            medianKosPerHour: row.medianKosPerHour,
          })),
          data: aggregate,
        } satisfies CareerWeaponHistorySnapshot & { generationId: string; data: CareerWeaponUsageAggregate }
      })
      return { status: 'available', filters, entries: buildCareerWeaponUsageHistory(historySnapshots) }
    },

    async getCareerWeaponUsage(filters): Promise<CareerWeaponUsageView> {
      const [snapshot] = await client<CareerSnapshotRow[]>`
        SELECT snapshot.id AS snapshot_id, snapshot.generation_id,
               snapshot.cohort_methodology_version, snapshot.methodology_version,
               generation.observation_window_starts_at, generation.observation_window_ends_at,
               snapshot.published_at, scope.selected_players, scope.successful_observations,
               scope.total_held_seconds
        FROM statistics.career_weapon_usage_snapshots snapshot
        JOIN statistics.cohort_generations generation ON generation.id = snapshot.generation_id
        JOIN statistics.career_weapon_usage_scopes scope ON scope.snapshot_id = snapshot.id
        WHERE snapshot.sealed_at IS NOT NULL
          AND scope.region = ${filters.region} AND scope.bracket = ${filters.bracket}
        ORDER BY snapshot.published_at DESC, snapshot.id DESC
        LIMIT 1
      `
      if (!snapshot) return { status: 'unavailable', reason: 'not-yet-published', filters }
      if (snapshot.methodology_version !== CAREER_WEAPON_USAGE_METHODOLOGY_VERSION) {
        throw new Error('Career Weapon Usage snapshot has an unsupported methodology version')
      }
      const [latestDecision, rows] = await Promise.all([
        client<DecisionRow[]>`
          SELECT id, generation_id, product, effect_operation_id, operation_key, decision,
                 reasons, progress, observation_window, capacity_envelope, decided_at
          FROM statistics.publication_decisions
          WHERE product = 'lifetime'
          ORDER BY decided_at DESC, id DESC LIMIT 1
        `,
        client<CareerWeaponRow[]>`
          SELECT weapon, observed_players, held_time_seconds, contributor_count,
                 qualifying_held_seconds, median_damage_numerator, median_damage_denominator,
                 median_kos_numerator, median_kos_denominator, comparison_eligible, comparison_reasons
          FROM statistics.career_weapon_usage_rows
          WHERE snapshot_id = ${snapshot.snapshot_id}
            AND region = ${filters.region} AND bracket = ${filters.bracket}
          ORDER BY weapon
        `,
      ])
      const latest = latestDecision[0]
      if (!latest) throw new Error('Career Weapon Usage snapshot has no lifetime publication decision')
      const expectedNextPublicationAt = new Date(
        snapshot.observation_window_ends_at.getTime() + 7 * 24 * 60 * 60 * 1_000,
      )
      const staleReasons: Array<'newer-publication-rejected' | 'weekly-publication-overdue'> = []
      if (latest.decision === 'rejected' && latest.generation_id !== snapshot.generation_id) {
        staleReasons.push('newer-publication-rejected')
      }
      if (now().getTime() >= expectedNextPublicationAt.getTime()) {
        staleReasons.push('weekly-publication-overdue')
      }
      const totalHeldSeconds = BigInt(snapshot.total_held_seconds)
      return {
        status: staleReasons.length > 0 ? 'stale' : 'fresh',
        snapshotId: snapshot.snapshot_id,
        generationId: snapshot.generation_id,
        cohortMethodologyVersion: snapshot.cohort_methodology_version,
        methodologyVersion: snapshot.methodology_version,
        observationWindow: {
          startsAt: snapshot.observation_window_starts_at.toISOString(),
          endsAt: snapshot.observation_window_ends_at.toISOString(),
        },
        publishedAt: snapshot.published_at.toISOString(),
        expectedNextPublicationAt: expectedNextPublicationAt.toISOString(),
        filters,
        staleReasons,
        selectedPlayers: snapshot.selected_players,
        successfulObservations: snapshot.successful_observations,
        coverage:
          snapshot.selected_players > 0
            ? exactRatio(BigInt(snapshot.successful_observations), BigInt(snapshot.selected_players))
            : null,
        totalHeldSeconds: snapshot.total_held_seconds,
        rows: rows.map((row) => ({
          weapon: row.weapon,
          observedPlayers: row.observed_players,
          prevalence:
            snapshot.successful_observations > 0
              ? exactRatio(BigInt(row.observed_players), BigInt(snapshot.successful_observations))
              : null,
          heldTimeSeconds: row.held_time_seconds,
          heldTimeShare: totalHeldSeconds > 0n ? exactRatio(BigInt(row.held_time_seconds), totalHeldSeconds) : null,
          contributorCount: row.contributor_count,
          qualifyingHeldSeconds: row.qualifying_held_seconds,
          medianDamagePerMinute:
            row.median_damage_numerator !== null && row.median_damage_denominator !== null
              ? exactRatio(BigInt(row.median_damage_numerator), BigInt(row.median_damage_denominator))
              : null,
          medianKosPerHour:
            row.median_kos_numerator !== null && row.median_kos_denominator !== null
              ? exactRatio(BigInt(row.median_kos_numerator), BigInt(row.median_kos_denominator))
              : null,
          comparison: { eligible: row.comparison_eligible, reasons: row.comparison_reasons },
        })),
        latestDecision: decisionAudit(latest),
      }
    },

    async getPublication(product): Promise<PublicationStatus | null> {
      const [latest] = await client<DecisionRow[]>`
        SELECT id, generation_id, product, effect_operation_id, operation_key, decision,
               reasons, progress, observation_window, capacity_envelope, decided_at
        FROM statistics.publication_decisions WHERE product = ${product}
        ORDER BY decided_at DESC, id DESC LIMIT 1
      `
      if (!latest) return null
      const [active] = await client<DecisionRow[]>`
        SELECT id, generation_id, product, effect_operation_id, operation_key, decision,
               reasons, progress, observation_window, capacity_envelope, decided_at
        FROM statistics.publication_decisions WHERE product = ${product} AND decision = 'accepted'
        ORDER BY decided_at DESC, id DESC LIMIT 1
      `
      return {
        product,
        active: active ? decisionAudit(active) : null,
        latestDecision: decisionAudit(latest),
        stale: latest.decision === 'rejected' && active !== undefined,
      }
    },
  }

  return { ...tracer, close: () => client.end() }
}

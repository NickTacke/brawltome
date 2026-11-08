import type { Sql } from '@brawltome/foundation'
import type { EffectState, JobDefinition, Lease } from '../jobs/job-definition'
import {
  type DiscoveryProjectionKind,
  leaderboardOperationKinds,
  type OperationLease,
  type StatisticsCollectionKind,
} from '../model'

export type EffectStateEntry = Pick<JobDefinition<unknown>, 'effectState' | 'claimLockKey'>

export type EffectStates = Readonly<Partial<Record<OperationLease['kind'], EffectStateEntry>>>

type EffectLease = Pick<Lease<unknown>, 'operationId' | 'effectOperationId' | 'payload'>

export async function proofEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.proof_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

async function leaderboardEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.leaderboard_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function statisticsCollectionEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.statistics_collection_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function statisticsPublicationEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.statistics_publication_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function legendMetaPublicationEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id
    FROM refresh_operations.statistics_legend_meta_publication_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

function entriesForKinds<Kind extends string>(
  kinds: readonly Kind[],
  entry: EffectStateEntry,
): Record<Kind, EffectStateEntry> {
  return Object.fromEntries(kinds.map((kind) => [kind, entry])) as Record<Kind, EffectStateEntry>
}

// these jobs live in their owning module and bring their effect checks with them
type JobOwnedEffectKind =
  | DiscoveryProjectionKind
  | 'discovery-reconciliation'
  | 'clan-refresh'
  | 'proof'
  | 'primary-player-verification'
  | 'interactive-player-refresh'
  | 'ranked-player-pulse'
  | 'player-name-verification'
  | StatisticsCollectionKind
  | 'statistics-publication'
  | 'statistics-legend-meta-publication'

// a job in the list brings its own entry, the rest are still here until they move; a new kind fails typecheck here
// until it says how claim reads its effect
export function createEffectStates(jobs: readonly JobDefinition<unknown>[]): EffectStates {
  const effectStatesByKind: Record<Exclude<OperationLease['kind'], JobOwnedEffectKind>, EffectStateEntry> = {
    'ranking-retention': {},
    'leaderboard-deep-crawl': {},
    ...entriesForKinds(leaderboardOperationKinds, { effectState: leaderboardEffectState }),
  }

  return { ...effectStatesByKind, ...Object.fromEntries(jobs.map((job) => [job.kind, job])) }
}

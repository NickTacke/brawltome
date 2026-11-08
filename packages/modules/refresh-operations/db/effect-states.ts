import type { Sql } from '@brawltome/foundation'
import type { EffectState, JobDefinition, Lease } from '../jobs/job-definition'
import type { OperationLease } from '../model'

export type EffectStateEntry = Pick<JobDefinition<unknown>, 'effectState' | 'claimLockKey'>

export type EffectStates = Readonly<Partial<Record<OperationLease['kind'], EffectStateEntry>>>

type EffectLease = Pick<Lease<unknown>, 'operationId' | 'effectOperationId' | 'payload'>

export async function leaderboardEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
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

// every job states how claim reads its effect, so a kind in the list needs nothing more to be claimable
export function createEffectStates(jobs: readonly JobDefinition<unknown>[]): EffectStates {
  return Object.fromEntries(jobs.map((job) => [job.kind, job]))
}

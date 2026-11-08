import type { Sql } from '@brawltome/foundation'
import type { EffectState, JobDefinition, Lease } from '../jobs/job-definition'
import {
  type DiscoveryProjectionKind,
  leaderboardOperationKinds,
  type OperationLease,
  statisticsCollectionKinds,
} from '../model'

export type EffectStateEntry = Pick<JobDefinition<unknown>, 'effectState' | 'claimLockKey'>

export type EffectStates = Readonly<Partial<Record<OperationLease['kind'], EffectStateEntry>>>

type EffectLease = Pick<Lease<unknown>, 'operationId' | 'effectOperationId' | 'payload'>

async function proofEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
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

async function statisticsCollectionEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.statistics_collection_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

async function statisticsPublicationEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.statistics_publication_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

async function legendMetaPublicationEffectState(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id
    FROM refresh_operations.statistics_legend_meta_publication_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

async function allSectionsCommitted(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ complete: boolean }[]>`
    SELECT NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(operation.payload -> 'staleSections') AS required(section)
      WHERE NOT EXISTS (
        SELECT 1
        FROM refresh_operations.interactive_refresh_effects effect
        WHERE effect.operation_id = operation.effect_operation_id AND effect.section = required.section
      )
    ) AS complete
    FROM refresh_operations.operations operation
    WHERE operation.id = ${lease.operationId}
  `

  return effect?.complete ? 'acknowledged' : 'none'
}

async function rankedSectionCommitted(sql: Sql, lease: EffectLease): Promise<EffectState> {
  const [effect] = await sql<{ complete: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM refresh_operations.interactive_refresh_effects effect
      WHERE effect.operation_id = ${lease.effectOperationId} AND effect.section = 'ranked'
    ) AS complete
  `

  return effect?.complete ? 'acknowledged' : 'none'
}

function entriesForKinds<Kind extends string>(
  kinds: readonly Kind[],
  entry: EffectStateEntry,
): Record<Kind, EffectStateEntry> {
  return Object.fromEntries(kinds.map((kind) => [kind, entry])) as Record<Kind, EffectStateEntry>
}

// these jobs live in their owning module and bring their effect checks with them
type JobOwnedEffectKind = DiscoveryProjectionKind | 'discovery-reconciliation'

// a job in the list brings its own entry, the rest are still here until they move; a new kind fails typecheck here
// until it says how claim reads its effect
export function createEffectStates(jobs: readonly JobDefinition<unknown>[]): EffectStates {
  const effectStatesByKind: Record<Exclude<OperationLease['kind'], JobOwnedEffectKind>, EffectStateEntry> = {
    proof: { effectState: proofEffectState },
    'interactive-player-refresh': { effectState: allSectionsCommitted },
    'clan-refresh': { effectState: allSectionsCommitted },
    'ranked-player-pulse': { effectState: rankedSectionCommitted },
    'player-name-verification': { effectState: rankedSectionCommitted },
    'ranking-retention': {},
    'leaderboard-deep-crawl': {},
    'statistics-publication': { effectState: statisticsPublicationEffectState },
    'statistics-legend-meta-publication': { effectState: legendMetaPublicationEffectState },
    ...entriesForKinds(statisticsCollectionKinds, { effectState: statisticsCollectionEffectState }),
    ...entriesForKinds(leaderboardOperationKinds, { effectState: leaderboardEffectState }),
  }

  return { ...effectStatesByKind, ...Object.fromEntries(jobs.map((job) => [job.kind, job])) }
}

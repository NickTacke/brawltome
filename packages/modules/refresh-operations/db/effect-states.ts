import type { Sql } from '@brawltome/foundation'
import type { EffectState, JobDefinition, Lease } from '../jobs/job-definition'
import {
  type DiscoveryEffectChecks,
  type DiscoveryOwner,
  leaderboardOperationKinds,
  type OperationLease,
  statisticsCollectionKinds,
} from '../model'

export type EffectStateEntry = Pick<JobDefinition<unknown>, 'effectState' | 'claimLockKey'>

export type EffectStates = Readonly<Partial<Record<OperationLease['kind'], EffectStateEntry>>>

type EffectLease = Pick<Lease<unknown>, 'operationId' | 'effectOperationId' | 'payload'>

type EffectStateDependencies = {
  discovery: DiscoveryEffectChecks
}

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

function discoveryClaimLockKey(effectOperationId: string): string {
  return `discovery-effect:${effectOperationId}`
}

function projectionEntry(discovery: DiscoveryEffectChecks, owner: DiscoveryOwner): EffectStateEntry {
  return {
    claimLockKey: discoveryClaimLockKey,
    effectState: (_sql, lease) => discovery.projectionEffectState(owner, lease.effectOperationId),
  }
}

function reconciliationEntry(discovery: DiscoveryEffectChecks): EffectStateEntry {
  return {
    claimLockKey: discoveryClaimLockKey,
    // reconciliation has no in-between: once its effect landed there is nothing left to retry
    effectState: async (_sql, lease) => {
      const isApplied = await discovery.reconciliationEffectApplied(lease.effectOperationId)

      return isApplied ? 'acknowledged' : 'none'
    },
  }
}

function entriesForKinds<Kind extends string>(
  kinds: readonly Kind[],
  entry: EffectStateEntry,
): Record<Kind, EffectStateEntry> {
  return Object.fromEntries(kinds.map((kind) => [kind, entry])) as Record<Kind, EffectStateEntry>
}

// a new kind fails typecheck here until it says how claim reads its effect
export function createEffectStates({ discovery }: EffectStateDependencies): EffectStates {
  const effectStatesByKind: Record<OperationLease['kind'], EffectStateEntry> = {
    proof: { effectState: proofEffectState },
    'interactive-player-refresh': { effectState: allSectionsCommitted },
    'clan-refresh': { effectState: allSectionsCommitted },
    'ranked-player-pulse': { effectState: rankedSectionCommitted },
    'player-name-verification': { effectState: rankedSectionCommitted },
    'player-discovery-projection': projectionEntry(discovery, 'player'),
    'clan-discovery-projection': projectionEntry(discovery, 'clan'),
    'discovery-reconciliation': reconciliationEntry(discovery),
    'ranking-retention': {},
    'leaderboard-deep-crawl': {},
    'statistics-publication': { effectState: statisticsPublicationEffectState },
    'statistics-legend-meta-publication': { effectState: legendMetaPublicationEffectState },
    ...entriesForKinds(statisticsCollectionKinds, { effectState: statisticsCollectionEffectState }),
    ...entriesForKinds(leaderboardOperationKinds, { effectState: leaderboardEffectState }),
  }

  return effectStatesByKind
}

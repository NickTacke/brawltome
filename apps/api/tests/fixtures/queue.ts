import {
  createEffectStates,
  createPostgresRefreshOperations,
  type DiscoveryEffectChecks,
  type RefreshOperationsDatabases,
} from '@brawltome/refresh-operations'

const noDiscoveryEffects: DiscoveryEffectChecks = {
  projectionEffectState: async () => 'none',
  reconciliationEffectApplied: async () => false,
}

/** Builds the queue the way the worker does, so expired leases read the same effect tables. */
export function createTestQueue(databases: RefreshOperationsDatabases, discovery = noDiscoveryEffects) {
  return createPostgresRefreshOperations(databases, { effectStates: createEffectStates({ discovery }) })
}

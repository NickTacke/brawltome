type ReconciliationOwner = 'player' | 'clan'

type OwnerState = {
  operationId: string | null
  consecutiveFailures: number
  cooldownUntil: number
}

// A dead-lettered reconciliation never writes discovery.reconciliation_runs, so `reconciliationDue` stays true and
// the scheduler would enqueue a replacement on every tick. Track the run this worker enqueued and, once it is
// dead-lettered, hold off for a cooldown that doubles with each consecutive failure (capped) until a run succeeds.
export function createDiscoveryReconciliationBackoff(options: {
  baseMs: number
  maxMs: number
  operationStatus(operationId: string): Promise<string | null>
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const states = new Map<ReconciliationOwner, OwnerState>()

  function stateFor(owner: ReconciliationOwner): OwnerState {
    let state = states.get(owner)
    if (!state) {
      state = { operationId: null, consecutiveFailures: 0, cooldownUntil: 0 }
      states.set(owner, state)
    }
    return state
  }

  return {
    async shouldEnqueue(owner: ReconciliationOwner): Promise<boolean> {
      const state = stateFor(owner)
      if (now() < state.cooldownUntil) return false
      if (state.operationId === null) return true
      const status = await options.operationStatus(state.operationId)
      if (status === 'dead_letter') {
        state.operationId = null
        state.consecutiveFailures++
        const cooldownMs = Math.min(options.maxMs, options.baseMs * 2 ** (state.consecutiveFailures - 1))
        state.cooldownUntil = now() + cooldownMs
        return false
      }
      if (status === 'succeeded') {
        state.operationId = null
        state.consecutiveFailures = 0
      } else if (status === null) {
        state.operationId = null
      }
      return true
    },

    recordEnqueued(owner: ReconciliationOwner, operationId: string): void {
      stateFor(owner).operationId = operationId
    },
  }
}

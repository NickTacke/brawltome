import type { ClanRefreshSection } from './refresh-section'

/** The clan side of a refresh lease: the operation and section it covers, and the lease the worker holds. */
export type ClanRefreshEffect = {
  operationId: string
  section: ClanRefreshSection
  leaseToken: number
  leaseExpiresAt: Date
}

export type ClanEffectPreparation = 'execute' | 'already-applied' | 'fenced'

// the stored effect row; isActive is worked out by the database clock, the same clock that expires the lease
export type RefreshEffectState = {
  leaseToken: number
  appliedAt: Date | null
  isActive: boolean
}

/**
 * Decides whether a holder of the given lease may publish. A missing row, a newer lease, or a revoked or expired one
 * fences it; a row already applied means the work is done.
 */
export function effectPreparation(state: RefreshEffectState | undefined, leaseToken: number): ClanEffectPreparation {
  if (!state || state.leaseToken !== leaseToken || !state.isActive) return 'fenced'

  if (state.appliedAt) return 'already-applied'

  return 'execute'
}

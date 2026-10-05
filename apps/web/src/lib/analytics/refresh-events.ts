import type { PlayerRefreshStatus } from '../player-refresh-status'
import type { AnalyticsEventInput } from './schema'

const MAX_WAIT_MS = 600_000
const MAX_RETRIES = 10

export function clampWaitMs(ms: number): number {
  return Number.isFinite(ms) ? Math.min(MAX_WAIT_MS, Math.max(0, Math.round(ms))) : 0
}

export function clampRetries(retries: number): number {
  return Number.isFinite(retries) ? Math.min(MAX_RETRIES, Math.max(0, Math.round(retries))) : 0
}

function stateEvent(
  state: Extract<AnalyticsEventInput, { name: 'refresh.state' }>['state'],
): Extract<AnalyticsEventInput, { name: 'refresh.state' }> {
  return { name: 'refresh.state', state }
}

function changed(previous: PlayerRefreshStatus, next: PlayerRefreshStatus): boolean {
  if (previous.kind !== next.kind) return true
  const previousReason = 'reason' in previous ? previous.reason : undefined
  const nextReason = 'reason' in next ? next.reason : undefined
  return previousReason !== nextReason
}

/** Maps a refresh status transition to the user-visible state worth measuring, or null. */
export function refreshStateEvent(
  previous: PlayerRefreshStatus,
  next: PlayerRefreshStatus,
  hasData: boolean,
): AnalyticsEventInput | null {
  if (!changed(previous, next)) return null
  switch (next.kind) {
    case 'requesting':
      return hasData ? null : stateEvent('looking_up')
    case 'waiting':
      return stateEvent(next.reason === 'rateLimited' ? 'rate_limited' : 'busy')
    case 'gaveUp':
      return stateEvent('gave_up')
    case 'timedOut':
      return stateEvent(hasData ? 'still_updating' : 'timed_out')
    case 'verificationFailed':
      return stateEvent('verify_failed')
    default:
      return null
  }
}

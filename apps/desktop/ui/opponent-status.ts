import type { OpponentFreshness, OpponentRefreshState } from './types'

interface OpponentStatus {
  freshness: OpponentFreshness
  refreshState: OpponentRefreshState
  retryAfterSeconds: number | null
}

export function desktopMatchLabel(isRanked: boolean): string {
  return isRanked ? 'Ranked players' : 'Players'
}

function retryMessage(prefix: string, afterSeconds: number | null): string {
  return afterSeconds === null ? `${prefix}. Try again.` : `${prefix}. Try again in ${afterSeconds} seconds.`
}

export function opponentStatusMessage(status: OpponentStatus): string {
  switch (status.refreshState) {
    case 'refreshing':
      return 'Refreshing'
    case 'verificationRequired':
      return 'Verification required. Try again.'
    case 'rateLimited':
      return retryMessage('Update delayed', status.retryAfterSeconds)
    case 'temporarilyUnavailable':
      return retryMessage(status.freshness === 'stale' ? 'Update delayed' : 'Unavailable', status.retryAfterSeconds)
    case 'apiFailure':
      return status.freshness === 'stale' ? 'Update delayed. Try again.' : 'Unavailable. Try again.'
    case 'idle':
      break
  }

  switch (status.freshness) {
    case 'fresh':
      return 'Updated'
    case 'stale':
      return 'Update delayed'
    case 'unavailable':
    case 'missing':
      return 'Unavailable'
  }
}

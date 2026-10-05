import type { PendingPlayerSections } from './player-refresh'
import type { RefreshClientOutcome } from './refresh-outcome'

/** Automatic retries per refresh cycle for rate-limited or unavailable responses. */
export const MAX_AUTO_RETRIES = 3
/** Retry delay used when the refresh request itself fails (network or server action error). */
const REQUEST_FAILED_RETRY_SECONDS = 30
/** Minimum time between visibility-triggered staleness checks. */
const VISIBILITY_RECHECK_MIN_INTERVAL_MS = 60_000

export type BlockedRefreshReason = 'rateLimited' | 'temporarilyUnavailable'

export type PlayerRefreshStatus =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'polling' }
  | { kind: 'verifying' }
  | { kind: 'verificationFailed' }
  | { kind: 'waiting'; reason: BlockedRefreshReason; retryAt: number }
  | { kind: 'gaveUp'; reason: BlockedRefreshReason }
  | { kind: 'timedOut' }

export interface PlayerRefreshState {
  status: PlayerRefreshStatus
  /** Automatic retries already scheduled in the current cycle. */
  autoRetries: number
  /** Incremented for every accepted refresh so polling restarts from the latest data. */
  pollRun: number
  lastRequestAt: number | null
}

export type PlayerRefreshEvent =
  | { type: 'request'; manual: boolean; now: number }
  | { type: 'outcome'; refresh: RefreshClientOutcome; now: number }
  | { type: 'requestFailed'; now: number }
  | { type: 'pollSettled'; settlement: 'done' | 'timeout' | 'error' }
  | { type: 'verificationFailed' }

export const initialPlayerRefreshState: PlayerRefreshState = {
  status: { kind: 'idle' },
  autoRetries: 0,
  pollRun: 0,
  lastRequestAt: null,
}

function blocked(
  state: PlayerRefreshState,
  reason: BlockedRefreshReason,
  afterSeconds: number,
  now: number,
): PlayerRefreshState {
  if (state.autoRetries >= MAX_AUTO_RETRIES) {
    return { ...state, status: { kind: 'gaveUp', reason } }
  }
  return {
    ...state,
    autoRetries: state.autoRetries + 1,
    status: { kind: 'waiting', reason, retryAt: now + afterSeconds * 1_000 },
  }
}

export function playerRefreshReducer(state: PlayerRefreshState, event: PlayerRefreshEvent): PlayerRefreshState {
  switch (event.type) {
    case 'request':
      return {
        ...state,
        autoRetries: event.manual ? 0 : state.autoRetries,
        status: { kind: 'requesting' },
        lastRequestAt: event.now,
      }
    case 'outcome': {
      if (state.status.kind !== 'requesting') return state
      const { refresh } = event
      switch (refresh.outcome) {
        case 'accepted':
        case 'alreadyRefreshing':
          return { ...state, status: { kind: 'polling' }, pollRun: state.pollRun + 1 }
        case 'notNeeded':
          return { ...state, status: { kind: 'idle' } }
        case 'verificationRequired':
          return { ...state, status: { kind: 'verifying' } }
        case 'rateLimited':
        case 'temporarilyUnavailable':
          return blocked(state, refresh.outcome, refresh.retry.afterSeconds, event.now)
      }
      return state
    }
    case 'requestFailed':
      if (state.status.kind !== 'requesting') return state
      return blocked(state, 'temporarilyUnavailable', REQUEST_FAILED_RETRY_SECONDS, event.now)
    case 'pollSettled':
      if (state.status.kind !== 'polling') return state
      return { ...state, status: event.settlement === 'timeout' ? { kind: 'timedOut' } : { kind: 'idle' } }
    case 'verificationFailed':
      return { ...state, status: { kind: 'verificationFailed' } }
  }
}

export function secondsUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 1_000))
}

export function shouldRecheckOnVisible(state: PlayerRefreshState, pending: PendingPlayerSections, now: number) {
  const settled = state.status.kind === 'idle' || state.status.kind === 'timedOut' || state.status.kind === 'gaveUp'
  if (!settled || (!pending.ranked && !pending.stats)) return false
  return state.lastRequestAt === null || now - state.lastRequestAt >= VISIBILITY_RECHECK_MIN_INTERVAL_MS
}

export interface PlayerRefreshNotice {
  tone: 'info' | 'warning'
  title: string
  detail: string
  countdownSeconds: number | null
  action: { label: string } | null
}

interface NoticeContext {
  hasData: boolean
  secondsLeft: number | null
  /** Relative age of the cached data, e.g. "3h ago". */
  dataAge: string | null
}

function showingData(dataAge: string | null) {
  return dataAge && dataAge !== 'just now' ? `Showing data from ${dataAge}.` : 'Showing the latest saved data.'
}

const BLOCKED_TITLE: Record<BlockedRefreshReason, string> = {
  rateLimited: 'Too many update requests right now',
  temporarilyUnavailable: "Brawlhalla's servers are busy",
}

export function getPlayerRefreshNotice(
  status: PlayerRefreshStatus,
  { hasData, secondsLeft, dataAge }: NoticeContext,
): PlayerRefreshNotice | null {
  switch (status.kind) {
    case 'waiting': {
      const seconds = secondsLeft ?? 0
      const countdown = seconds > 0 ? `Retrying in ${seconds}s.` : 'Retrying now...'
      return {
        tone: 'warning',
        title: BLOCKED_TITLE[status.reason],
        detail: hasData ? `${countdown} ${showingData(dataAge)}` : countdown,
        countdownSeconds: seconds,
        action: { label: 'Try now' },
      }
    }
    case 'gaveUp': {
      const cause =
        status.reason === 'rateLimited' ? 'Too many update requests right now.' : "Brawlhalla's servers are still busy."
      return {
        tone: 'warning',
        title: "Couldn't update this player",
        detail: `${cause} ${hasData ? showingData(dataAge) : 'Wait a minute and try again.'}`,
        countdownSeconds: null,
        action: { label: 'Try again' },
      }
    }
    case 'timedOut':
      return hasData
        ? {
            tone: 'info',
            title: 'Still updating',
            detail: `${showingData(dataAge)} Fresh stats can take a little longer to arrive.`,
            countdownSeconds: null,
            action: { label: 'Refresh' },
          }
        : {
            tone: 'warning',
            title: "Couldn't load this player yet",
            detail: "Brawlhalla hasn't answered in time. Check the player ID, or try again in a minute.",
            countdownSeconds: null,
            action: { label: 'Try again' },
          }
    case 'verificationFailed':
      return {
        tone: 'warning',
        title: "Couldn't verify your browser",
        detail: hasData
          ? `Fresh stats need a quick verification. ${showingData(dataAge)}`
          : 'Fresh stats need a quick verification before we can look this player up.',
        countdownSeconds: null,
        action: { label: 'Try again' },
      }
    default:
      return null
  }
}

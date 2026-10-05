'use client'

import { getPlayerAction, refreshPlayerAction } from '@/app/player/[id]/actions'
import type { PlayerData } from '@/components/player/shared'
import { flushAnalytics, track } from '@/lib/analytics/browser'
import {
  abandonRefresh,
  clampRetries,
  clampWaitMs,
  createStateDeduper,
  refreshStateEvent,
} from '@/lib/analytics/refresh-events'
import {
  PLAYER_REFRESH_MAX_WAIT_MS,
  type PendingPlayerSections,
  getPendingPlayerSections,
  hasCompletedPlayerRefresh,
  playerRefreshPollDelayMs,
} from '@/lib/player-refresh'
import {
  initialPlayerRefreshState,
  playerRefreshReducer,
  secondsUntil,
  shouldRecheckOnVisible,
} from '@/lib/player-refresh-status'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useStaleRefresh } from './useStaleRefresh'

interface RefreshBaseline {
  data: PlayerData | null
  pending: PendingPlayerSections
}

function baselineFor(data: PlayerData | null): RefreshBaseline {
  return { data, pending: getPendingPlayerSections(data) }
}

/**
 * Drives a player profile refresh cycle: requests a refresh when data is stale, automatically retries
 * rate-limited/unavailable responses with a countdown, polls until fresh data lands, and re-checks
 * staleness when the tab becomes visible again.
 */
export function usePlayerRefresh({ id, initialData }: { id: string; initialData: PlayerData | null }) {
  const [state, dispatch] = useReducer(playerRefreshReducer, initialPlayerRefreshState)
  const [now, setNow] = useState(() => Date.now())
  const stateRef = useRef(state)
  const baselineRef = useRef<RefreshBaseline>(baselineFor(initialData))
  const mountedRef = useRef(false)
  const initialRequestedRef = useRef(false)
  const tokenInFlightRef = useRef(false)
  const previousStatusRef = useRef(state.status)
  const cycleStartedAtRef = useRef(0)
  const retriesRef = useRef(0)
  const abandonedRef = useRef(false)
  const stateDeduperRef = useRef(createStateDeduper())
  stateRef.current = state

  const queryFn = useCallback(() => getPlayerAction(Number(id)), [id])
  const { data, error } = useStaleRefresh<PlayerData | null>({
    initialData,
    queryFn,
    shouldStart: () => true,
    isDone: (_previous, next) => hasCompletedPlayerRefresh(baselineRef.current.data, next, baselineRef.current.pending),
    startSignal: state.pollRun > 0,
    runKey: state.pollRun,
    pollMs: playerRefreshPollDelayMs,
    maxRefreshMs: PLAYER_REFRESH_MAX_WAIT_MS,
    onSettled: (settlement) => {
      if (settlement === 'done') {
        track({
          name: 'refresh.completed',
          waitMs: clampWaitMs(performance.now() - cycleStartedAtRef.current),
          retries: clampRetries(retriesRef.current),
        })
        retriesRef.current = 0
      }
      dispatch({ type: 'pollSettled', settlement })
    },
  })
  const dataRef = useRef(data)
  dataRef.current = data

  const request = useCallback(
    async (manual: boolean, token?: string) => {
      if (manual) {
        cycleStartedAtRef.current = performance.now()
        abandonedRef.current = false
        stateDeduperRef.current.reset()
        retriesRef.current = 0
      }
      dispatch({ type: 'request', manual, now: Date.now() })
      try {
        const result = await refreshPlayerAction(Number(id), token)
        if (mountedRef.current) dispatch({ type: 'outcome', refresh: result.refresh, now: Date.now() })
      } catch {
        if (mountedRef.current) dispatch({ type: 'requestFailed', now: Date.now() })
      }
    },
    [id],
  )

  /** Starts a new cycle measured against the data currently on screen. */
  const startCycle = useCallback(() => {
    baselineRef.current = baselineFor(dataRef.current)
    void request(true)
  }, [request])

  useEffect(() => {
    mountedRef.current = true
    const abandon = () =>
      abandonRefresh(stateRef.current.status.kind, abandonedRef, performance.now() - cycleStartedAtRef.current, {
        track,
        flush: flushAnalytics,
      })
    window.addEventListener('pagehide', abandon)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', abandon)
      abandon()
    }
  }, [])

  useEffect(() => {
    if (initialRequestedRef.current) return
    const { pending } = baselineRef.current
    if (!pending.ranked && !pending.stats) return
    initialRequestedRef.current = true
    void request(true)
  }, [request])

  const { status } = state

  useEffect(() => {
    const event = refreshStateEvent(previousStatusRef.current, status, Boolean(dataRef.current))
    previousStatusRef.current = status
    if (event && stateDeduperRef.current.allow(event)) track(event)
  }, [status])

  useEffect(() => {
    if (status.kind !== 'waiting') return
    setNow(Date.now())
    const intervalId = setInterval(() => setNow(Date.now()), 1_000)
    const timeoutId = setTimeout(
      () => {
        retriesRef.current += 1
        void request(false)
      },
      Math.max(0, status.retryAt - Date.now()),
    )
    return () => {
      clearInterval(intervalId)
      clearTimeout(timeoutId)
    }
  }, [status, request])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (!shouldRecheckOnVisible(stateRef.current, getPendingPlayerSections(dataRef.current), Date.now())) return
      startCycle()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [startCycle])

  const submitToken = useCallback(
    async (token: string) => {
      if (tokenInFlightRef.current || stateRef.current.status.kind !== 'verifying') return
      tokenInFlightRef.current = true
      try {
        await request(false, token)
      } finally {
        tokenInFlightRef.current = false
      }
    },
    [request],
  )

  const failVerification = useCallback(() => dispatch({ type: 'verificationFailed' }), [])

  return {
    data,
    error,
    status,
    isRefreshing: status.kind === 'requesting' || status.kind === 'polling',
    careerRefreshing: baselineRef.current.pending.stats,
    secondsLeft: status.kind === 'waiting' ? secondsUntil(status.retryAt, now) : null,
    retry: startCycle,
    submitToken,
    failVerification,
  }
}

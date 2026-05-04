import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import type { DetectionStateSnapshot, DetectionStatus, GameEvent, Opponent } from '../types'

const AUTO_HIDE_MS = 10_000
// How long to keep the status badge visible after Ready arrives, before it
// fades. Long enough that the user has time to register "Ready" without it
// lingering ambiently while they're just hanging out in the menu.
const READY_LINGER_MS = 5_000

export function useGameEvents() {
  const [opponents, setOpponents] = useState<Opponent[]>([])
  const [matchType, setMatchType] = useState('Players')
  const [visible, setVisible] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>('idle')
  const [localPlayerBhid, setLocalPlayerBhid] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emitCountRef = useRef(0)
  const matchActiveRef = useRef(false)

  useEffect(() => {
    let disposed = false
    let sawLifecycleEvent = false
    let unlistenFn: (() => void) | null = null

    const clearStatusHideTimer = () => {
      if (statusHideTimerRef.current) {
        clearTimeout(statusHideTimerRef.current)
        statusHideTimerRef.current = null
      }
    }

    const hideStatusNow = () => {
      clearStatusHideTimer()
      setDetectionStatus('idle')
      setLocalPlayerBhid(null)
    }

    void (async () => {
      // Register the live listener BEFORE requesting the snapshot. If we
      // requested the snapshot first, Tauri events firing between the
      // command resolving and `listen` registering would be lost, and the
      // snapshot's stale state could overwrite a live `detached` that
      // arrived in the meantime.
      const unlisten = await listen<GameEvent>('game-event', ({ payload }) => {
        // Any live event implies the Rust-side state has moved past the
        // snapshot frame, including match_started / match_ended (which mutate
        // the snapshot's matchActive field). Mark the flag for every event so
        // the snapshot can never roll back a live update.
        sawLifecycleEvent = true

        if (payload.event === 'scanning') {
          setScanning(true)
          setVisible(true)
          setOpponents([])
          emitCountRef.current = 0
          // Match panel takes over; the status badge gets out of the way.
          hideStatusNow()
        } else if (payload.event === 'match_found') {
          setScanning(false)
          setOpponents(payload.opponents)
          setMatchType(payload.isRanked ? 'Players' : 'Custom')
          setVisible(true)
          matchActiveRef.current = true
          hideStatusNow()

          emitCountRef.current += 1
          setRefreshing(emitCountRef.current <= 1)

          if (!timerRef.current) {
            timerRef.current = setTimeout(() => {
              setVisible(false)
              timerRef.current = null
            }, AUTO_HIDE_MS)
          }
        } else if (payload.event === 'match_ended') {
          setOpponents([])
          setVisible(false)
          setScanning(false)
          setRefreshing(false)
          emitCountRef.current = 0
          matchActiveRef.current = false
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
        } else if (payload.event === 'attached') {
          if (!matchActiveRef.current) {
            setDetectionStatus('attaching')
            setLocalPlayerBhid(null)
            clearStatusHideTimer()
          }
        } else if (payload.event === 'local_player_found') {
          if (!matchActiveRef.current) {
            setDetectionStatus('player_loaded')
            setLocalPlayerBhid(payload.bhid)
            clearStatusHideTimer()
          }
        } else if (payload.event === 'ready') {
          if (!matchActiveRef.current) {
            setDetectionStatus('ready')
            clearStatusHideTimer()
            // Hold "Ready" on screen for a beat so the user can read it, then
            // fade out so the overlay area is clear during steady-state menu
            // browsing.
            statusHideTimerRef.current = setTimeout(hideStatusNow, READY_LINGER_MS)
          }
        } else if (payload.event === 'detached') {
          // Hide immediately on detach; lingering with stale "Ready" text after
          // Brawlhalla closed would be misleading.
          hideStatusNow()
          setOpponents([])
          setVisible(false)
          setScanning(false)
          setRefreshing(false)
          emitCountRef.current = 0
          matchActiveRef.current = false
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
        }
      })

      if (disposed) {
        unlisten()
        return
      }
      unlistenFn = unlisten

      // Now safe to fetch the snapshot. Skip applying it if a live lifecycle
      // event has already arrived (the live event reflects the true current
      // state and the snapshot may be stale by the time it resolves).
      try {
        const snapshot = await invoke<DetectionStateSnapshot>('get_detection_state')
        if (disposed || sawLifecycleEvent) return

        if (snapshot.matchActive) {
          matchActiveRef.current = true
        }
        if (!snapshot.attached || snapshot.matchActive) return

        if (snapshot.ready) {
          setDetectionStatus('ready')
          setLocalPlayerBhid(snapshot.bhid)
          clearStatusHideTimer()
          statusHideTimerRef.current = setTimeout(hideStatusNow, READY_LINGER_MS)
        } else if (snapshot.bhid !== null) {
          setDetectionStatus('player_loaded')
          setLocalPlayerBhid(snapshot.bhid)
        } else {
          setDetectionStatus('attaching')
        }
      } catch {
        // Best-effort. If the command fails (non-Windows build, shutdown
        // race) live events going forward will populate the badge.
      }
    })()

    return () => {
      disposed = true
      unlistenFn?.()
      if (timerRef.current) clearTimeout(timerRef.current)
      if (statusHideTimerRef.current) clearTimeout(statusHideTimerRef.current)
    }
  }, [])

  return {
    opponents,
    matchType,
    visible,
    scanning,
    refreshing,
    detectionStatus,
    localPlayerBhid,
  }
}

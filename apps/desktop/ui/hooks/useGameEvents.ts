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
  const [attached, setAttached] = useState(false)
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>('idle')
  const [localPlayerBhid, setLocalPlayerBhid] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emitCountRef = useRef(0)
  const matchActiveRef = useRef(false)

  useEffect(() => {
    // Seed state from the backend snapshot. Tauri events are not buffered for
    // late subscribers, so if Brawlhalla was already running and detection
    // emitted Attached/LocalPlayerFound/Ready before the webview finished
    // mounting, this is how we recover the current status.
    invoke<DetectionStateSnapshot>('get_detection_state')
      .then((snapshot) => {
        if (snapshot.matchActive) {
          matchActiveRef.current = true
        }
        if (!snapshot.attached || snapshot.matchActive) return
        if (snapshot.ready) {
          setDetectionStatus('ready')
          setLocalPlayerBhid(snapshot.bhid)
          if (statusHideTimerRef.current) clearTimeout(statusHideTimerRef.current)
          statusHideTimerRef.current = setTimeout(() => {
            setDetectionStatus('idle')
            setLocalPlayerBhid(null)
            statusHideTimerRef.current = null
          }, READY_LINGER_MS)
        } else if (snapshot.bhid !== null) {
          setDetectionStatus('player_loaded')
          setLocalPlayerBhid(snapshot.bhid)
        } else {
          setDetectionStatus('attaching')
        }
      })
      .catch(() => {
        // Detection state is best-effort: if the command fails (non-Windows
        // build, race during shutdown, etc.) we still get live events going
        // forward.
      })

    const unlisten = listen<GameEvent>('game-event', ({ payload }) => {
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
        setAttached(true)
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
        setAttached(false)
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

    return () => {
      unlisten.then((fn) => fn())
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
    attached,
    detectionStatus,
    localPlayerBhid,
  }
}

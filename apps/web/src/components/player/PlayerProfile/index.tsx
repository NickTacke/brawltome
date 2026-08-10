'use client'

import { getPlayerAction, refreshPlayerAction } from '@/app/player/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { RefreshTimeoutError, useStaleRefresh } from '@/hooks/useStaleRefresh'
import { getPendingPlayerSections, hasCompletedPlayerRefresh } from '@/lib/player-refresh'
import { getRefreshClientAction } from '@/lib/refresh-outcome'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerData } from '../shared'
import { LookupState } from './LookupState'
import { PlayerProfileHierarchy } from './PlayerProfileHierarchy'

interface PlayerProfileProps {
  initialData: PlayerData | null
  id: string
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const [turnstileError, setTurnstileError] = useState(false)
  const [refreshAccepted, setRefreshAccepted] = useState(false)
  const [verificationRequired, setVerificationRequired] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const initialRefreshHandled = useRef(false)
  const tokenHandled = useRef(false)

  const pendingSections = useMemo(() => getPendingPlayerSections(initialData), [initialData])
  const queryFn = () => getPlayerAction(Number(id))
  const shouldStart = () => pendingSections.ranked || pendingSections.stats
  const isDone = (_prev: PlayerData | null, next: PlayerData | null) =>
    hasCompletedPlayerRefresh(initialData, next, pendingSections)

  const {
    data: player,
    isRefreshing,
    error,
  } = useStaleRefresh<PlayerData | null>({
    initialData,
    queryFn,
    shouldStart,
    isDone,
    startSignal: refreshAccepted,
  })

  const applyRefreshOutcome = useCallback((refresh: Parameters<typeof getRefreshClientAction>[0]) => {
    const action = getRefreshClientAction(refresh)
    setRefreshAccepted(action.poll)
    setVerificationRequired(action.verify)
    setRefreshMessage(action.message)
    return action
  }, [])

  useEffect(() => {
    if (initialRefreshHandled.current || (!pendingSections.ranked && !pendingSections.stats)) return
    initialRefreshHandled.current = true
    void refreshPlayerAction(Number(id))
      .then((result) => applyRefreshOutcome(result.refresh))
      .catch(() => setRefreshAccepted(false))
  }, [applyRefreshOutcome, id, pendingSections.ranked, pendingSections.stats])

  const handleToken = useCallback(
    async (token: string) => {
      if (tokenHandled.current) return
      tokenHandled.current = true
      try {
        const result = await refreshPlayerAction(Number(id), token)
        const action = applyRefreshOutcome(result.refresh)
        if (action.verify) tokenHandled.current = false
      } catch {
        tokenHandled.current = false
      }
    },
    [applyRefreshOutcome, id],
  )

  const displayPlayer = player
  const turnstile = verificationRequired ? (
    <TurnstileGate onToken={handleToken} onError={() => setTurnstileError(true)} />
  ) : null

  if (error && !(error instanceof RefreshTimeoutError)) {
    throw error
  }

  if (!displayPlayer) {
    const lookupFailed = turnstileError || error instanceof RefreshTimeoutError
    return <LookupState errored={lookupFailed} message={refreshMessage} turnstile={turnstile} />
  }

  return (
    <div className="space-y-8 pb-10">
      {turnstile}
      {refreshMessage && <output className="text-sm text-muted-foreground">{refreshMessage}</output>}
      <NavBar showBack />
      <PlayerProfileHierarchy
        player={displayPlayer}
        refreshing={isRefreshing}
        careerRefreshing={isRefreshing && pendingSections.stats}
      />
    </div>
  )
}

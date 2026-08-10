'use client'

import { getPlayerAction, refreshPlayerAction } from '@/app/player/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { RefreshTimeoutError, useStaleRefresh } from '@/hooks/useStaleRefresh'
import { useAccount } from '@/lib/auth'
import { getPendingPlayerSections, hasCompletedPlayerRefresh } from '@/lib/player-refresh'
import { getRefreshClientAction } from '@/lib/refresh-outcome'
import { removeSavedPlayer, savePlayer, useSavedPlayers } from '@/lib/savedPlayers'
import { MAX_SAVED_PLAYERS } from '@brawltome/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerData } from '../shared'
import { LookupState } from './LookupState'
import { PlayerProfileHierarchy } from './PlayerProfileHierarchy'
import { SavedPlayerButton } from './SavedPlayerButton'

interface PlayerProfileProps {
  initialData: PlayerData | null
  id: string
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const queryClient = useQueryClient()
  const { account } = useAccount()
  const {
    savedPlayers,
    isLoading: savedPlayersLoading,
    isError: savedPlayersQueryError,
    isReady: savedPlayersReady,
  } = useSavedPlayers(account?.id)
  const [savedPlayerPending, setSavedPlayerPending] = useState(false)
  const [savedPlayerError, setSavedPlayerError] = useState<string | null>(null)
  const [savedPlayerStatus, setSavedPlayerStatus] = useState('')
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
  const brawlhallaId = Number(id)
  const isSaved = savedPlayers.some((savedPlayer) => savedPlayer.brawlhallaId === brawlhallaId)
  const savedPlayerLimitReached = !isSaved && savedPlayers.length >= MAX_SAVED_PLAYERS

  async function toggleSavedPlayer() {
    if (!account || !Number.isInteger(brawlhallaId) || brawlhallaId < 1) return
    if (savedPlayerLimitReached) return
    setSavedPlayerPending(true)
    setSavedPlayerError(null)
    setSavedPlayerStatus('')
    try {
      if (isSaved) {
        await removeSavedPlayer(queryClient, account.id, brawlhallaId)
        setSavedPlayerStatus('Removed player from Saved Players.')
      } else {
        await savePlayer(queryClient, account.id, brawlhallaId)
        setSavedPlayerStatus('Saved player to Saved Players.')
      }
    } catch {
      setSavedPlayerError('Could not update Saved Players. Try again.')
    } finally {
      setSavedPlayerPending(false)
    }
  }

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
      {account && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {savedPlayersLoading && <output className="text-muted-foreground text-sm">Loading Saved Players...</output>}
          {savedPlayersQueryError && (
            <p role="alert" className="text-sm text-red-300">
              Saved Players are unavailable. Try again.
            </p>
          )}
          {savedPlayerError && (
            <p role="alert" className="text-sm text-red-300">
              {savedPlayerError}
            </p>
          )}
          <output aria-live="polite" className="sr-only">
            {savedPlayerPending ? 'Updating Saved Players.' : savedPlayerStatus}
          </output>
          {savedPlayersReady && (
            <SavedPlayerButton
              saved={isSaved}
              pending={savedPlayerPending}
              disabled={savedPlayerLimitReached}
              onToggle={() => void toggleSavedPlayer()}
            />
          )}
        </div>
      )}
      <PlayerProfileHierarchy
        player={displayPlayer}
        refreshing={isRefreshing}
        careerRefreshing={isRefreshing && pendingSections.stats}
      />
    </div>
  )
}

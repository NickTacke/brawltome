'use client'

import { getPlayerAction, refreshPlayerAction } from '@/app/player/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { RefreshTimeoutError, useStaleRefresh } from '@/hooks/useStaleRefresh'
import { useAccount, usePrimaryPlayer } from '@/lib/auth'
import { pinPlayer, unpinPlayer, usePinnedPlayers } from '@/lib/pinnedPlayers'
import { getPendingPlayerSections, hasCompletedPlayerRefresh } from '@/lib/player-refresh'
import { getRefreshClientAction } from '@/lib/refresh-outcome'
import { MAX_PINNED_PLAYERS } from '@brawltome/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerData } from '../shared'
import { LookupState } from './LookupState'
import { PinnedPlayerButton } from './PinnedPlayerButton'
import { PlayerProfileHierarchy } from './PlayerProfileHierarchy'

interface PlayerProfileProps {
  initialData: PlayerData | null
  id: string
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const queryClient = useQueryClient()
  const { account } = useAccount()
  const { state: primaryPlayerState } = usePrimaryPlayer()
  const {
    pinnedPlayers,
    isLoading: pinnedPlayersLoading,
    isError: pinnedPlayersQueryError,
    isReady: pinnedPlayersReady,
  } = usePinnedPlayers(account?.id)
  const [pinnedPlayerPending, setPinnedPlayerPending] = useState(false)
  const [pinnedPlayerError, setPinnedPlayerError] = useState<string | null>(null)
  const [pinnedPlayerStatus, setPinnedPlayerStatus] = useState('')
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
  const isPinned = pinnedPlayers.some((pinnedPlayer) => pinnedPlayer.brawlhallaId === brawlhallaId)
  const isPrimaryPlayer = primaryPlayerState?.primaryPlayer?.brawlhallaId === brawlhallaId
  const pinnedPlayerLimitReached = !isPinned && pinnedPlayers.length >= MAX_PINNED_PLAYERS

  async function togglePinnedPlayer() {
    if (!account || !Number.isInteger(brawlhallaId) || brawlhallaId < 1) return
    if (isPrimaryPlayer || pinnedPlayerLimitReached) return
    setPinnedPlayerPending(true)
    setPinnedPlayerError(null)
    setPinnedPlayerStatus('')
    try {
      if (isPinned) {
        await unpinPlayer(queryClient, account.id, brawlhallaId)
        setPinnedPlayerStatus('Unpinned player from Pinned Players.')
      } else {
        await pinPlayer(queryClient, account.id, brawlhallaId)
        setPinnedPlayerStatus('Pinned player to Pinned Players.')
      }
    } catch {
      setPinnedPlayerError('Could not update Pinned Players. Try again.')
    } finally {
      setPinnedPlayerPending(false)
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NavBar showBack />
        {account && (
          <>
            <output aria-live="polite" className="sr-only">
              {pinnedPlayerPending ? 'Updating Pinned Players.' : pinnedPlayerStatus}
            </output>
            {pinnedPlayersLoading && (
              <output className="text-muted-foreground text-sm">Loading Pinned Players...</output>
            )}
            {pinnedPlayersReady && !isPrimaryPlayer && (
              <PinnedPlayerButton
                pinned={isPinned}
                pending={pinnedPlayerPending}
                disabled={pinnedPlayerLimitReached}
                onToggle={() => void togglePinnedPlayer()}
              />
            )}
          </>
        )}
      </div>
      {pinnedPlayersQueryError && (
        <p role="alert" className="text-sm text-red-300">
          Pinned Players are unavailable. Try again.
        </p>
      )}
      {pinnedPlayerError && (
        <p role="alert" className="text-sm text-red-300">
          {pinnedPlayerError}
        </p>
      )}
      <PlayerProfileHierarchy
        player={displayPlayer}
        refreshing={isRefreshing}
        careerRefreshing={isRefreshing && pendingSections.stats}
      />
    </div>
  )
}

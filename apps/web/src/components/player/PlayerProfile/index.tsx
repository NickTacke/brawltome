'use client'

import { recordProfileViewAction } from '@/app/player/[id]/actions'
import { NavBar } from '@/components/NavBar'
import { TurnstileGate } from '@/components/TurnstileGate'
import { usePlayerRefresh } from '@/hooks/usePlayerRefresh'
import { RefreshTimeoutError } from '@/hooks/useStaleRefresh'
import { track } from '@/lib/analytics/browser'
import { dataAgeBucket } from '@/lib/analytics/labels'
import { useAccount, usePrimaryPlayer } from '@/lib/auth'
import { pinPlayer, unpinPlayer, usePinnedPlayers } from '@/lib/pinnedPlayers'
import { getPlayerDataUpdatedAt } from '@/lib/player-refresh'
import { getPlayerRefreshNotice } from '@/lib/player-refresh-status'
import { timeAgo } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { PlayerData } from '../shared'
import { LookupState } from './LookupState'
import { PinnedPlayerButton } from './PinnedPlayerButton'
import { PlayerProfileHierarchy } from './PlayerProfileHierarchy'
import { hasPinnedPlayerLimitReached, shouldShowPinnedPlayerButton } from './player-profile-state'

interface PlayerProfileProps {
  initialData: PlayerData | null
  id: string
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const queryClient = useQueryClient()
  const { account } = useAccount()
  const { state: primaryPlayerState, isLoading: primaryPlayerLoading, isError: primaryPlayerError } = usePrimaryPlayer()
  const {
    pinnedPlayers,
    isLoading: pinnedPlayersLoading,
    isError: pinnedPlayersQueryError,
    isReady: pinnedPlayersReady,
  } = usePinnedPlayers(account?.id)
  const [pinnedPlayerPending, setPinnedPlayerPending] = useState(false)
  const [optimisticPinned, setOptimisticPinned] = useState<boolean | null>(null)
  const [pinnedPlayerError, setPinnedPlayerError] = useState<string | null>(null)
  const [pinnedPlayerStatus, setPinnedPlayerStatus] = useState('')
  const {
    data: player,
    error,
    status: refreshStatus,
    isRefreshing,
    careerRefreshing,
    secondsLeft,
    retry,
    submitToken,
    failVerification,
  } = usePlayerRefresh({ id, initialData })

  const displayPlayer = player
  const firstRenderDataRef = useRef(initialData)

  useEffect(() => {
    void recordProfileViewAction(Number(id))
    const viewedAt = Date.now()
    const sectionAge = (lastSuccessAt: string | null | undefined) =>
      dataAgeBucket(lastSuccessAt ? new Date(lastSuccessAt) : null, viewedAt)
    track({
      name: 'profile.viewed',
      dataAge: dataAgeBucket(getPlayerDataUpdatedAt(firstRenderDataRef.current), viewedAt),
      rankedAge: sectionAge(firstRenderDataRef.current?.currentSeason?.lastSuccessAt),
      statsAge: sectionAge(firstRenderDataRef.current?.career?.lastSuccessAt),
    })
  }, [id])
  const brawlhallaId = Number(id)
  const primaryPlayerKnown = !primaryPlayerLoading && !primaryPlayerError
  const primaryPlayerId = primaryPlayerKnown ? (primaryPlayerState?.primaryPlayer?.brawlhallaId ?? null) : null
  const queriedIsPinned = pinnedPlayers.some((pinnedPlayer) => pinnedPlayer.brawlhallaId === brawlhallaId)
  const isPinned = optimisticPinned ?? queriedIsPinned
  const isPrimaryPlayer = primaryPlayerId === brawlhallaId
  const pinnedPlayerLimitReached = hasPinnedPlayerLimitReached(pinnedPlayers, primaryPlayerId, brawlhallaId)
  const showPinnedPlayerButton = shouldShowPinnedPlayerButton({
    accountSignedIn: Boolean(account),
    pinnedPlayersReady,
    playerId: brawlhallaId,
    primaryPlayerId,
    primaryPlayerLoading,
    primaryPlayerError,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: profile identity changes reset the local optimistic state.
  useEffect(() => {
    setOptimisticPinned(null)
  }, [account?.id, brawlhallaId])

  async function togglePinnedPlayer() {
    if (!account || !Number.isInteger(brawlhallaId) || brawlhallaId < 1) return
    if (!primaryPlayerKnown || isPrimaryPlayer || pinnedPlayerLimitReached) return
    const nextPinned = !isPinned
    setOptimisticPinned(nextPinned)
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
      setOptimisticPinned(null)
    } catch {
      setOptimisticPinned(null)
      setPinnedPlayerError('Could not update Pinned Players. Try again.')
    } finally {
      setPinnedPlayerPending(false)
    }
  }

  const turnstile =
    refreshStatus.kind === 'verifying' ? <TurnstileGate onToken={submitToken} onError={failVerification} /> : null

  if (error && !(error instanceof RefreshTimeoutError)) {
    throw error
  }

  const updatedAt = getPlayerDataUpdatedAt(displayPlayer)
  const refreshNotice = getPlayerRefreshNotice(refreshStatus, {
    hasData: Boolean(displayPlayer),
    secondsLeft,
    dataAge: updatedAt ? timeAgo(updatedAt) : null,
  })

  function retryWithTracking() {
    if (!displayPlayer || refreshStatus.kind === 'gaveUp') track({ name: 'deadend', kind: 'try_again_clicked' })
    retry()
  }

  if (!displayPlayer) {
    return (
      <>
        <LookupState id={id} notice={refreshNotice} onAction={retryWithTracking} turnstile={turnstile} />
      </>
    )
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NavBar showBack />
        {account && (
          <>
            <output aria-live="polite" className="sr-only">
              {pinnedPlayerStatus}
            </output>
            {pinnedPlayersLoading && (
              <output className="text-muted-foreground text-sm">Loading Pinned Players...</output>
            )}
            {showPinnedPlayerButton && (
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
      {turnstile}
      <PlayerProfileHierarchy
        player={displayPlayer}
        refreshing={isRefreshing}
        careerRefreshing={isRefreshing && careerRefreshing}
      />
    </div>
  )
}

import { MAX_PINNED_PLAYERS } from '@brawltome/contracts'

type PinnedPlayerId = { brawlhallaId: number }

interface PinnedPlayerButtonVisibility {
  accountSignedIn: boolean
  pinnedPlayersReady: boolean
  playerId: number
  primaryPlayerId: number | null
  primaryPlayerLoading: boolean
  primaryPlayerError: boolean
}

export function shouldShowPinnedPlayerButton({
  accountSignedIn,
  pinnedPlayersReady,
  playerId,
  primaryPlayerId,
  primaryPlayerLoading,
  primaryPlayerError,
}: PinnedPlayerButtonVisibility): boolean {
  return (
    accountSignedIn &&
    pinnedPlayersReady &&
    !primaryPlayerLoading &&
    !primaryPlayerError &&
    playerId !== primaryPlayerId
  )
}

export function hasPinnedPlayerLimitReached(
  pinnedPlayers: ReadonlyArray<PinnedPlayerId>,
  primaryPlayerId: number | null,
  playerId: number,
): boolean {
  const isPinned = pinnedPlayers.some(({ brawlhallaId }) => brawlhallaId === playerId)
  const managedPinnedCount = pinnedPlayers.filter(({ brawlhallaId }) => brawlhallaId !== primaryPlayerId).length
  return !isPinned && managedPinnedCount >= MAX_PINNED_PLAYERS
}

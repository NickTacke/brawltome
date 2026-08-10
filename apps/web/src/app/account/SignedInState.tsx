'use client'

import { signOut, usePrimaryPlayer } from '@/lib/auth'
import { invalidatePlayerNavigation } from '@/lib/playerShortcuts'
import {
  movePinnedPlayer,
  moveSavedPlayer,
  orderedPinnedPlayers,
  pinSavedPlayer,
  removeSavedPlayer,
  reorderPinnedPlayers,
  reorderSavedPlayers,
  unpinSavedPlayer,
  useSavedPlayers,
} from '@/lib/savedPlayers'
import type { AccountContract } from '@brawltome/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { Link2, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BrawlhallaLinkRow } from './BrawlhallaLinkRow'
import { DiscordIcon } from './DiscordIcon'
import { SavedPlayersSection } from './SavedPlayersSection'

interface SignedInStateProps {
  account: AccountContract
}

export function SignedInState({ account }: SignedInStateProps) {
  const queryClient = useQueryClient()
  const { state: primaryPlayerState, isLoading: primaryPlayerLoading, isError: primaryPlayerError } = usePrimaryPlayer()
  const { savedPlayers, isLoading: savedPlayersLoading, isError: savedPlayersQueryError } = useSavedPlayers(account.id)
  const savedPlayersHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousPrimaryPlayerIdRef = useRef<number | null | undefined>(undefined)
  const [pendingPlayerId, setPendingPlayerId] = useState<number | null>(null)
  const [savedPlayersError, setSavedPlayersError] = useState<string | null>(null)
  const [savedPlayersStatus, setSavedPlayersStatus] = useState('')
  const memberSince = new Date(account.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  useEffect(() => {
    if (primaryPlayerLoading || primaryPlayerError) return
    const primaryPlayerId = primaryPlayerState?.primaryPlayer?.brawlhallaId ?? null
    const previousPrimaryPlayerId = previousPrimaryPlayerIdRef.current
    previousPrimaryPlayerIdRef.current = primaryPlayerId
    if (previousPrimaryPlayerId === undefined || previousPrimaryPlayerId === primaryPlayerId) return
    void invalidatePlayerNavigation(queryClient, account.id)
  }, [account.id, primaryPlayerError, primaryPlayerLoading, primaryPlayerState, queryClient])

  async function handleRemove(brawlhallaId: number) {
    if (pendingPlayerId !== null) return
    const removed = savedPlayers.find((savedPlayer) => savedPlayer.brawlhallaId === brawlhallaId)
    const label = removed?.player?.name ?? `Player ID ${brawlhallaId}`
    setPendingPlayerId(brawlhallaId)
    setSavedPlayersError(null)
    setSavedPlayersStatus('')
    try {
      await removeSavedPlayer(queryClient, account.id, brawlhallaId)
      setSavedPlayersStatus(`Removed ${label} from Saved Players.`)
      savedPlayersHeadingRef.current?.focus()
    } catch {
      setSavedPlayersError('Could not update Saved Players. Try again.')
    } finally {
      setPendingPlayerId(null)
    }
  }

  async function handleMove(fromIndex: number, toIndex: number) {
    if (pendingPlayerId !== null) return
    const brawlhallaIds = moveSavedPlayer(savedPlayers, fromIndex, toIndex)
    if (brawlhallaIds.every((id, index) => id === savedPlayers[index]?.brawlhallaId)) return
    const moved = savedPlayers[fromIndex]
    setPendingPlayerId(moved?.brawlhallaId ?? null)
    setSavedPlayersError(null)
    setSavedPlayersStatus('')
    try {
      await reorderSavedPlayers(queryClient, account.id, brawlhallaIds)
      const label = moved?.player?.name ?? `Player ID ${moved?.brawlhallaId ?? ''}`
      setSavedPlayersStatus(`Moved ${label} to Saved Players position ${toIndex + 1}.`)
    } catch {
      setSavedPlayersError('Could not reorder Saved Players. Try again.')
    } finally {
      setPendingPlayerId(null)
    }
  }

  async function handleTogglePin(brawlhallaId: number, pinned: boolean) {
    if (pendingPlayerId !== null) return
    const player = savedPlayers.find((savedPlayer) => savedPlayer.brawlhallaId === brawlhallaId)
    const label = player?.player?.name ?? `Player ID ${brawlhallaId}`
    setPendingPlayerId(brawlhallaId)
    setSavedPlayersError(null)
    setSavedPlayersStatus('')
    try {
      if (pinned) await unpinSavedPlayer(queryClient, account.id, brawlhallaId)
      else await pinSavedPlayer(queryClient, account.id, brawlhallaId)
      setSavedPlayersStatus(`${pinned ? 'Unpinned' : 'Pinned'} ${label}.`)
    } catch {
      setSavedPlayersError('Could not update pinned shortcuts. Try again.')
    } finally {
      setPendingPlayerId(null)
    }
  }

  async function handleMovePin(fromIndex: number, toIndex: number) {
    if (pendingPlayerId !== null) return
    const currentPinned = orderedPinnedPlayers(savedPlayers)
    const moved = currentPinned[fromIndex]
    const brawlhallaIds = movePinnedPlayer(savedPlayers, fromIndex, toIndex)
    if (!moved || brawlhallaIds.every((id, index) => id === currentPinned[index]?.brawlhallaId)) return
    setPendingPlayerId(moved.brawlhallaId)
    setSavedPlayersError(null)
    setSavedPlayersStatus('')
    try {
      await reorderPinnedPlayers(queryClient, account.id, brawlhallaIds)
      const label = moved.player?.name ?? `Player ID ${moved.brawlhallaId}`
      setSavedPlayersStatus(`Moved ${label} to pinned shortcut position ${toIndex + 1}.`)
    } catch {
      setSavedPlayersError('Could not reorder pinned shortcuts. Try again.')
    } finally {
      setPendingPlayerId(null)
    }
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col gap-6 px-6 py-12">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <div className="flex items-center gap-4">
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover ring-2 ring-white/[0.08]"
            />
          ) : (
            <div className="bg-muted flex h-16 w-16 items-center justify-center rounded-full ring-2 ring-white/[0.08]">
              <Users className="text-muted-foreground h-7 w-7" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{account.displayName}</h1>
            <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
              <DiscordIcon className="h-3.5 w-3.5" />
              <span>Connected via Discord</span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">Member since {memberSince}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold">Linked Accounts</h2>
        <div className="mt-4 space-y-3">
          <BrawlhallaLinkRow state={primaryPlayerState} loading={primaryPlayerLoading} />
          <div className="border-border/50 border-t" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-white/[0.06] p-2">
                <Link2 className="text-muted-foreground h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Socials</p>
                <p className="text-muted-foreground text-xs">Connect your social profiles</p>
              </div>
            </div>
            <span className="text-muted-foreground rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
              Soon
            </span>
          </div>
        </div>
      </div>

      <SavedPlayersSection
        savedPlayers={savedPlayers}
        loading={savedPlayersLoading}
        error={savedPlayersQueryError}
        headingRef={savedPlayersHeadingRef}
        pendingPlayerId={pendingPlayerId}
        primaryPlayerId={primaryPlayerState?.primaryPlayer?.brawlhallaId ?? null}
        primaryPlayerUnavailable={primaryPlayerLoading || primaryPlayerError}
        onRemove={(brawlhallaId) => void handleRemove(brawlhallaId)}
        onMove={(fromIndex, toIndex) => void handleMove(fromIndex, toIndex)}
        onTogglePin={(brawlhallaId, pinned) => void handleTogglePin(brawlhallaId, pinned)}
        onMovePin={(fromIndex, toIndex) => void handleMovePin(fromIndex, toIndex)}
      />
      <output aria-live="polite" className="text-muted-foreground block text-sm">
        {savedPlayersStatus}
      </output>
      {savedPlayersError && (
        <p role="alert" className="text-sm text-red-300">
          {savedPlayersError}
        </p>
      )}

      <button
        type="button"
        onClick={() => signOut(queryClient)}
        className="text-muted-foreground hover:text-foreground cursor-pointer self-center text-sm underline-offset-4 transition-colors hover:underline"
      >
        Sign out
      </button>
    </main>
  )
}

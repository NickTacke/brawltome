'use client'

import { saveAccountPreferences, signOut, useAccountPreferences, usePrimaryPlayer } from '@/lib/auth'
import { movePinnedPlayer, reorderPinnedPlayers, unpinPlayer, usePinnedPlayers } from '@/lib/pinnedPlayers'
import { invalidatePlayerNavigation } from '@/lib/playerShortcuts'
import { ACCOUNT_THEME_OPTIONS } from '@/lib/theme'
import type { AccountContract } from '@brawltome/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { BrawlhallaLinkRow } from './BrawlhallaLinkRow'
import { DiscordIcon } from './DiscordIcon'
import { PinnedPlayersSection } from './PinnedPlayersSection'

interface SignedInStateProps {
  account: AccountContract
}

export function SignedInState({ account }: SignedInStateProps) {
  const queryClient = useQueryClient()
  const { preferences, isLoading: preferencesLoading } = useAccountPreferences(account.id)
  const { state: primaryPlayerState, isLoading: primaryPlayerLoading, isError: primaryPlayerError } = usePrimaryPlayer()
  const {
    pinnedPlayers,
    isLoading: pinnedPlayersLoading,
    isError: pinnedPlayersQueryError,
  } = usePinnedPlayers(account.id)
  const primaryPlayerKnown = !primaryPlayerLoading && !primaryPlayerError
  const primaryPlayerId = primaryPlayerKnown ? (primaryPlayerState?.primaryPlayer?.brawlhallaId ?? null) : null
  const pinnedPlayersHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousPrimaryPlayerIdRef = useRef<number | null | undefined>(undefined)
  const [pendingPlayerId, setPendingPlayerId] = useState<number | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationStatus, setMutationStatus] = useState('')
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeError, setThemeError] = useState<string | null>(null)
  const memberSince = new Date(account.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  useEffect(() => {
    if (!primaryPlayerKnown) return
    const previousPrimaryPlayerId = previousPrimaryPlayerIdRef.current
    previousPrimaryPlayerIdRef.current = primaryPlayerId
    if (previousPrimaryPlayerId === undefined || previousPrimaryPlayerId === primaryPlayerId) return
    void invalidatePlayerNavigation(queryClient, account.id)
  }, [account.id, primaryPlayerKnown, primaryPlayerId, queryClient])

  async function handleThemeChange(event: ChangeEvent<HTMLSelectElement>) {
    const theme = ACCOUNT_THEME_OPTIONS.find(({ value }) => value === event.currentTarget.value)?.value
    if (!preferences || !theme || theme === preferences.theme) return
    setThemeSaving(true)
    setThemeError(null)
    try {
      await saveAccountPreferences(queryClient, account.id, { theme })
    } catch {
      setThemeError('Could not save your theme. Try again.')
    } finally {
      setThemeSaving(false)
    }
  }

  async function handleUnpin(brawlhallaId: number) {
    if (!primaryPlayerKnown || pendingPlayerId !== null || brawlhallaId === primaryPlayerId) return
    const unpinned = pinnedPlayers.find((pinnedPlayer) => pinnedPlayer.brawlhallaId === brawlhallaId)
    const label = unpinned?.player?.name ?? `Player ID ${brawlhallaId}`
    setPendingPlayerId(brawlhallaId)
    setMutationError(null)
    setMutationStatus('')
    try {
      await unpinPlayer(queryClient, account.id, brawlhallaId)
      setMutationStatus(`Unpinned ${label}.`)
      pinnedPlayersHeadingRef.current?.focus()
    } catch {
      setMutationError('Could not update Pinned Players. Try again.')
    } finally {
      setPendingPlayerId(null)
    }
  }

  async function handleMove(fromIndex: number, toIndex: number) {
    if (!primaryPlayerKnown || pendingPlayerId !== null) return
    const moved = pinnedPlayers[fromIndex]
    if (!moved || moved.brawlhallaId === primaryPlayerId) return
    const brawlhallaIds = movePinnedPlayer(pinnedPlayers, fromIndex, toIndex, primaryPlayerId)
    if (brawlhallaIds.every((id, index) => id === pinnedPlayers[index]?.brawlhallaId)) return
    setPendingPlayerId(moved.brawlhallaId)
    setMutationError(null)
    setMutationStatus('')
    try {
      await reorderPinnedPlayers(queryClient, account.id, brawlhallaIds)
      const label = moved.player?.name ?? `Player ID ${moved.brawlhallaId}`
      setMutationStatus(`Moved ${label} to Pinned Players position ${toIndex + 1}.`)
    } catch {
      setMutationError('Could not reorder Pinned Players. Try again.')
    } finally {
      setPendingPlayerId(null)
    }
  }

  return (
    <main className="mx-auto min-h-[60vh] max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
        <div className="flex items-start gap-4">
          {account.avatarUrl ? (
            <img
              src={account.avatarUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white/[0.08]"
            />
          ) : (
            <div className="bg-muted flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-2 ring-white/[0.08]">
              <Users className="text-muted-foreground h-7 w-7" aria-hidden="true" />
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
          <button
            type="button"
            onClick={() => void signOut(queryClient)}
            className="text-muted-foreground hover:text-foreground ml-auto shrink-0 rounded-md px-2 py-1 text-sm underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start">
        <PinnedPlayersSection
          pinnedPlayers={pinnedPlayers}
          loading={pinnedPlayersLoading}
          error={pinnedPlayersQueryError}
          headingRef={pinnedPlayersHeadingRef}
          pendingPlayerId={pendingPlayerId}
          primaryPlayerKnown={primaryPlayerKnown}
          primaryPlayerId={primaryPlayerId}
          onUnpin={(brawlhallaId) => void handleUnpin(brawlhallaId)}
          onMove={(fromIndex, toIndex) => void handleMove(fromIndex, toIndex)}
        />

        <aside className="space-y-6">
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
            <h2 className="text-sm font-semibold">Appearance</h2>
            <p className="text-muted-foreground mt-1 text-xs">Choose the color theme for BrawlTome.</p>
            <label className="mt-4 flex items-center justify-between gap-4 text-sm">
              <span>Theme</span>
              <select
                aria-label="Theme"
                value={preferences?.theme ?? 'neutral'}
                onChange={(event) => void handleThemeChange(event)}
                disabled={preferencesLoading || !preferences || themeSaving}
                className="bg-background border-border text-foreground min-h-10 rounded-md border px-3 text-sm"
              >
                {ACCOUNT_THEME_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {themeError && (
              <p role="alert" className="text-destructive mt-3 text-xs">
                {themeError}
              </p>
            )}
          </section>
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
            <h2 className="text-sm font-semibold">Primary Player</h2>
            <div className="mt-4">
              <BrawlhallaLinkRow state={primaryPlayerState} loading={primaryPlayerLoading} />
            </div>
          </section>
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
            <h2 className="text-sm font-semibold">Account summary</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Discord</dt>
                <dd>Connected</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Member since</dt>
                <dd>{memberSince}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <div className="mt-6 space-y-2">
        <output aria-live="polite" className="text-muted-foreground block text-sm">
          {mutationStatus}
        </output>
        {mutationError && (
          <p role="alert" className="text-sm text-red-300">
            {mutationError}
          </p>
        )}
      </div>
    </main>
  )
}

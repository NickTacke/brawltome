'use client'

import { Card } from '@/components/ui'
import { MAX_PINNED_PLAYERS, type PinnedPlayerContract, type PinnedPlayersContract } from '@brawltome/contracts'
import { ArrowDown, ArrowUp, PinOff } from 'lucide-react'
import Link from 'next/link'
import type { RefObject } from 'react'

interface PinnedPlayersSectionProps {
  pinnedPlayers: PinnedPlayersContract
  loading: boolean
  error?: boolean
  headingRef?: RefObject<HTMLHeadingElement | null>
  pendingPlayerId: number | null
  primaryPlayerKnown: boolean
  primaryPlayerId?: number | null
  onUnpin: (brawlhallaId: number) => void
  onMove: (fromIndex: number, toIndex: number) => void
}

function playerLabel(pinnedPlayer: PinnedPlayerContract): string {
  return pinnedPlayer.player?.name ?? `Player ID ${pinnedPlayer.brawlhallaId}`
}

function observationDate(value: string): string {
  return value.slice(0, 10)
}

function RankedObservation({ pinnedPlayer }: { pinnedPlayer: PinnedPlayerContract }) {
  const currentSeason = pinnedPlayer.currentSeason
  const snapshot = currentSeason?.snapshot
  if (!currentSeason || !snapshot)
    return <p className="text-muted-foreground text-sm">Ranked observation unavailable.</p>

  const { games, rating, tier, wins, region } = snapshot.oneVsOne
  const losses = Math.max(0, games - wins)
  const direction = snapshot.observedRatingDirection
  const directionLabel = direction
    ? `${direction.direction === 'up' ? 'Up' : direction.direction === 'down' ? 'Down' : 'Unchanged'} ${Math.abs(direction.ratingChange)} rating across ${direction.observationCount} observations`
    : null

  return (
    <div className="mt-5 border-t border-border/50 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-3xl font-black tracking-tight">{rating}</p>
          <p className="text-muted-foreground mt-1 text-xs font-semibold">
            {tier} <span aria-hidden="true">·</span> {region}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-black">
            {wins}W / {losses}L
          </p>
          <p className="text-muted-foreground text-xs">
            {currentSeason.freshness === 'fresh' ? 'Updated' : 'Update delayed'}
          </p>
        </div>
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span>Checked {observationDate(currentSeason.checkedAt)}</span>
        {directionLabel && <span>{directionLabel}</span>}
      </div>
    </div>
  )
}

export function PinnedPlayersSection({
  pinnedPlayers,
  loading,
  error = false,
  headingRef,
  pendingPlayerId,
  primaryPlayerKnown,
  primaryPlayerId = null,
  onUnpin,
  onMove,
}: PinnedPlayersSectionProps) {
  const managedPinnedCount = primaryPlayerKnown
    ? pinnedPlayers.filter(({ brawlhallaId }) => brawlhallaId !== primaryPlayerId).length
    : 0

  return (
    <section
      aria-labelledby="pinned-players-heading"
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-6"
    >
      <h2 ref={headingRef} id="pinned-players-heading" tabIndex={-1} className="text-lg font-semibold outline-none">
        Pinned Players
      </h2>
      {managedPinnedCount > MAX_PINNED_PLAYERS && (
        <p className="mt-3 text-xs text-amber-200" role="alert">
          This account has legacy pins above the current limit. Existing records are preserved; new pins are limited to
          20; remove a player before pinning another.
        </p>
      )}

      <div aria-live="polite" className="mt-4">
        {loading ? (
          <output className="text-muted-foreground block text-sm">Loading Pinned Players...</output>
        ) : error ? (
          <p className="text-sm text-red-300" role="alert">
            Pinned Players are unavailable. Try again.
          </p>
        ) : pinnedPlayers.length === 0 ? (
          <p className="text-muted-foreground text-sm">No Pinned Players yet.</p>
        ) : (
          <ol className="grid gap-4 sm:grid-cols-2">
            {pinnedPlayers.map((pinnedPlayer, index) => {
              const label = playerLabel(pinnedPlayer)
              const pending = pendingPlayerId !== null
              const isPrimary = primaryPlayerKnown && pinnedPlayer.brawlhallaId === primaryPlayerId
              return (
                <li key={pinnedPlayer.brawlhallaId} className="min-w-0">
                  <Card className="h-full min-w-0 bg-linear-to-br from-card to-background p-5">
                    <div className="flex min-w-0 items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link
                          href={`/player/${pinnedPlayer.brawlhallaId}`}
                          prefetch={false}
                          className="focus-visible:ring-primary block truncate rounded-sm text-xl font-black tracking-tight hover:text-primary focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {label}
                        </Link>
                        <p className="text-muted-foreground mt-1 text-xs font-mono">ID {pinnedPlayer.brawlhallaId}</p>
                      </div>
                      {isPrimary ? (
                        <span className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-muted-foreground">
                          You
                        </span>
                      ) : (
                        primaryPlayerKnown && (
                          <fieldset
                            aria-label={`${label} actions`}
                            className="flex shrink-0 items-center gap-1 border-0 p-0"
                          >
                            <button
                              type="button"
                              aria-label={`Move ${label} up in Pinned Players`}
                              disabled={index === 0 || pending}
                              onClick={() => onMove(index, index - 1)}
                              className="focus-visible:ring-primary flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                            >
                              <ArrowUp className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${label} down in Pinned Players`}
                              disabled={index === pinnedPlayers.length - 1 || pending}
                              onClick={() => onMove(index, index + 1)}
                              className="focus-visible:ring-primary flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                            >
                              <ArrowDown className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Unpin ${label}`}
                              disabled={pending}
                              onClick={() => onUnpin(pinnedPlayer.brawlhallaId)}
                              className="focus-visible:ring-primary flex h-10 w-10 items-center justify-center rounded-xl text-red-300 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                            >
                              <PinOff className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </fieldset>
                        )
                      )}
                    </div>
                    <RankedObservation pinnedPlayer={pinnedPlayer} />
                  </Card>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

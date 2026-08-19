'use client'

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
  if (!currentSeason || !snapshot) {
    return (
      <div className="text-muted-foreground space-y-1 text-xs">
        <p>Current Season ranked facts unavailable.</p>
        {currentSeason?.checkedAt && (
          <details className="pt-1">
            <summary className="text-foreground cursor-pointer font-medium">Ranked observation details</summary>
            <p className="pt-2">
              Last checked <time dateTime={currentSeason.checkedAt}>{observationDate(currentSeason.checkedAt)}</time>.
              Missing facts are not shown as zero.
            </p>
          </details>
        )}
      </div>
    )
  }

  const direction = snapshot.observedRatingDirection
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Current Season</span>
        <span className="text-muted-foreground font-mono">Latest supported 1v1 rating: {snapshot.oneVsOne.rating}</span>
        <span className="text-muted-foreground">
          {currentSeason.freshness === 'fresh' ? 'Updated' : 'Update delayed'}
        </span>
      </div>
      <details className="text-muted-foreground">
        <summary className="text-foreground cursor-pointer font-medium">Ranked observation details</summary>
        <div className="space-y-2 pt-2">
          <p>
            Complete ranked facts last checked{' '}
            <time dateTime={currentSeason.checkedAt}>{observationDate(currentSeason.checkedAt)}</time>. Last successful
            observation{' '}
            {currentSeason.lastSuccessAt ? (
              <time dateTime={currentSeason.lastSuccessAt}>{observationDate(currentSeason.lastSuccessAt)}</time>
            ) : (
              'unavailable'
            )}
            . Freshness window: {currentSeason.freshForSeconds / 3_600} hour.
          </p>
          {currentSeason.sparsePulse ? (
            <p>
              Sparse pulse last checked{' '}
              <time dateTime={currentSeason.sparsePulse.checkedAt}>
                {observationDate(currentSeason.sparsePulse.checkedAt)}
              </time>
              .{' '}
              {currentSeason.sparsePulse.lastSuccessAt ? (
                <>
                  A supported scalar was last observed{' '}
                  <time dateTime={currentSeason.sparsePulse.lastSuccessAt}>
                    {observationDate(currentSeason.sparsePulse.lastSuccessAt)}
                  </time>
                  , so the latest supported rating may be newer than the complete ranked observation. Sparse pulses do
                  not update rank, tier, region, legends, Solo Queue, team composition, or rating history.
                </>
              ) : (
                'No supported scalar was observed, so the complete ranked facts remain unchanged.'
              )}
            </p>
          ) : (
            <p>
              No sparse pulse observation is available. The displayed rating comes from the complete ranked observation.
            </p>
          )}
          <div className="text-muted-foreground rounded-md border border-white/[0.06] p-2">
            <p className="text-foreground font-medium">BrawlTome-observed direction</p>
            {direction ? (
              <p>
                {direction.direction === 'up' ? 'Up' : direction.direction === 'down' ? 'Down' : 'Unchanged'}{' '}
                {Math.abs(direction.ratingChange)} rating across {direction.observationCount} observations. Direction
                compares {direction.observationCount} of up to 365 retained BrawlTome complete-ranked observations from{' '}
                {observationDate(direction.fromObservedAt)} to {observationDate(direction.toObservedAt)} within the
                latest monotonic-games segment. Sparse pulse overlays are excluded. This is BrawlTome coverage, not
                complete Elo history.
              </p>
            ) : (
              <p>No coverage-qualified rating change is available.</p>
            )}
          </div>
        </div>
      </details>
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
      <p className="text-muted-foreground mt-2 text-xs">
        Private pins visible only to you. Pinning a player does not claim ownership or create a public follow.
      </p>
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
          <ol className="space-y-3">
            {pinnedPlayers.map((pinnedPlayer, index) => {
              const label = playerLabel(pinnedPlayer)
              const pending = pendingPlayerId !== null
              const isPrimary = primaryPlayerKnown && pinnedPlayer.brawlhallaId === primaryPlayerId
              return (
                <li key={pinnedPlayer.brawlhallaId} className="rounded-lg border border-white/[0.06] bg-black/10 p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/player/${pinnedPlayer.brawlhallaId}`}
                          prefetch={false}
                          className="focus-visible:ring-primary truncate rounded-sm text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {label}
                        </Link>
                        <p className="text-muted-foreground mt-0.5 text-xs font-mono">ID {pinnedPlayer.brawlhallaId}</p>
                      </div>
                      {isPrimary && (
                        <span className="text-muted-foreground shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-xs font-medium">
                          You
                        </span>
                      )}
                    </div>
                    {primaryPlayerKnown && !isPrimary && (
                      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
                        <fieldset className="flex items-center gap-1 border-0 p-0">
                          <legend className="text-muted-foreground mr-1 text-[10px] font-medium uppercase">
                            Pinned order for {label}
                          </legend>
                          <button
                            type="button"
                            aria-label={`Move ${label} up in Pinned Players`}
                            disabled={index === 0 || pending}
                            onClick={() => onMove(index, index - 1)}
                            className="focus-visible:ring-primary rounded-md p-3.5 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${label} down in Pinned Players`}
                            disabled={index === pinnedPlayers.length - 1 || pending}
                            onClick={() => onMove(index, index + 1)}
                            className="focus-visible:ring-primary rounded-md p-3.5 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </fieldset>
                        <button
                          type="button"
                          aria-label={`Unpin ${label}`}
                          disabled={pending}
                          onClick={() => onUnpin(pinnedPlayer.brawlhallaId)}
                          className="focus-visible:ring-primary rounded-md p-3.5 text-red-300 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                        >
                          <PinOff className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <RankedObservation pinnedPlayer={pinnedPlayer} />
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

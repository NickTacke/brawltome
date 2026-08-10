'use client'

import { MAX_PINNED_PLAYERS, type SavedPlayerContract, type SavedPlayersContract } from '@brawltome/contracts'
import { ArrowDown, ArrowUp, Bookmark, Pin, PinOff, Trash2 } from 'lucide-react'
import Link from 'next/link'
import type { RefObject } from 'react'

interface SavedPlayersSectionProps {
  savedPlayers: SavedPlayersContract
  loading: boolean
  error?: boolean
  headingRef?: RefObject<HTMLHeadingElement | null>
  pendingPlayerId: number | null
  primaryPlayerId?: number | null
  primaryPlayerUnavailable?: boolean
  onRemove: (brawlhallaId: number) => void
  onMove: (fromIndex: number, toIndex: number) => void
  onTogglePin: (brawlhallaId: number, pinned: boolean) => void
  onMovePin: (fromIndex: number, toIndex: number) => void
}

function playerLabel(savedPlayer: SavedPlayerContract): string {
  return savedPlayer.player?.name ?? `Player ID ${savedPlayer.brawlhallaId}`
}

function observationDate(value: string): string {
  return value.slice(0, 10)
}

function RankedObservation({ savedPlayer }: { savedPlayer: SavedPlayerContract }) {
  const currentSeason = savedPlayer.currentSeason
  const snapshot = currentSeason?.snapshot
  if (!currentSeason || !snapshot) {
    return (
      <div className="text-muted-foreground space-y-1 text-xs">
        <p>Current Season ranked facts unavailable.</p>
        {currentSeason?.checkedAt && (
          <p>
            Last checked <time dateTime={currentSeason.checkedAt}>{observationDate(currentSeason.checkedAt)}</time>.
            Missing facts are not shown as zero.
          </p>
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
      <p className="text-muted-foreground">
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
        <p className="text-muted-foreground">
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
              , so the latest supported rating may be newer than the complete ranked observation. Sparse pulses do not
              update rank, tier, region, legends, Solo Queue, team composition, or rating history.
            </>
          ) : (
            'No supported scalar was observed, so the complete ranked facts remain unchanged.'
          )}
        </p>
      ) : (
        <p className="text-muted-foreground">
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
            {observationDate(direction.fromObservedAt)} to {observationDate(direction.toObservedAt)} within the latest
            monotonic-games segment. Sparse pulse overlays are excluded. This is BrawlTome coverage, not complete Elo
            history.
          </p>
        ) : (
          <p>No coverage-qualified rating change is available.</p>
        )}
      </div>
    </div>
  )
}

export function SavedPlayersSection({
  savedPlayers,
  loading,
  error = false,
  headingRef,
  pendingPlayerId,
  primaryPlayerId = null,
  primaryPlayerUnavailable = false,
  onRemove,
  onMove,
  onTogglePin,
  onMovePin,
}: SavedPlayersSectionProps) {
  const pinnedCount = savedPlayers.filter(({ pinOrder }) => pinOrder !== null).length
  return (
    <section
      aria-labelledby="saved-players-heading"
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6"
    >
      <div className="flex items-center gap-2">
        <Bookmark className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        <h2 ref={headingRef} id="saved-players-heading" tabIndex={-1} className="text-sm font-semibold outline-none">
          Saved Players
        </h2>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        Private bookmarks visible only to you. Saving a player does not claim ownership or create a public follow. Pin
        up to {MAX_PINNED_PLAYERS} shortcuts.
      </p>
      {!loading && !error && savedPlayers.length > 0 && (
        <p className="text-muted-foreground mt-1 text-xs">
          {pinnedCount} of {MAX_PINNED_PLAYERS} shortcuts pinned.
        </p>
      )}

      {loading ? (
        <output className="text-muted-foreground mt-4 block text-sm">Loading Saved Players...</output>
      ) : error ? (
        <p className="mt-4 text-sm text-red-300" role="alert">
          Saved Players are unavailable. Try again.
        </p>
      ) : savedPlayers.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">No Saved Players yet.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {savedPlayers.map((savedPlayer, index) => {
            const label = playerLabel(savedPlayer)
            const pending = pendingPlayerId !== null
            const pinned = savedPlayer.pinOrder !== null
            const pinOrder = savedPlayer.pinOrder
            const isPrimary = savedPlayer.brawlhallaId === primaryPlayerId
            return (
              <li key={savedPlayer.brawlhallaId} className="rounded-lg border border-white/[0.06] bg-black/10 p-4">
                <div className="flex flex-col gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/player/${savedPlayer.brawlhallaId}`}
                      prefetch={false}
                      className="focus-visible:ring-primary truncate rounded-sm text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {label}
                    </Link>
                    <p className="text-muted-foreground mt-0.5 text-xs font-mono">ID {savedPlayer.brawlhallaId}</p>
                  </div>
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
                    {isPrimary ? (
                      <span className="text-muted-foreground self-center px-2 text-xs">Shown as You</span>
                    ) : primaryPlayerUnavailable ? (
                      <span className="text-muted-foreground self-center px-2 text-xs">Pinning unavailable</span>
                    ) : (
                      <button
                        type="button"
                        aria-label={pinned ? `Unpin ${label} from shortcuts` : `Pin ${label} to shortcuts`}
                        aria-pressed={pinned}
                        disabled={pending || (!pinned && pinnedCount >= MAX_PINNED_PLAYERS)}
                        onClick={() => onTogglePin(savedPlayer.brawlhallaId, pinned)}
                        className="focus-visible:ring-primary rounded-md p-3.5 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                      >
                        {pinned ? (
                          <PinOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Pin className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    )}
                    {pinOrder !== null && (
                      <fieldset className="flex items-center gap-1 border-0 p-0">
                        <legend className="text-muted-foreground mr-1 text-[10px] font-medium uppercase">
                          Shortcut order for {label}
                        </legend>
                        <button
                          type="button"
                          aria-label={`Move ${label} up in pinned shortcuts`}
                          disabled={pinOrder === 0 || pending}
                          onClick={() => onMovePin(pinOrder, pinOrder - 1)}
                          className="focus-visible:ring-primary rounded-md p-3.5 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${label} down in pinned shortcuts`}
                          disabled={pinOrder === pinnedCount - 1 || pending}
                          onClick={() => onMovePin(pinOrder, pinOrder + 1)}
                          className="focus-visible:ring-primary rounded-md p-3.5 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </fieldset>
                    )}
                    <fieldset className="flex items-center gap-1 border-0 p-0">
                      <legend className="text-muted-foreground mr-1 text-[10px] font-medium uppercase">
                        Saved order for {label}
                      </legend>
                      <button
                        type="button"
                        aria-label={`Move ${label} up in Saved Players`}
                        disabled={index === 0 || pending}
                        onClick={() => onMove(index, index - 1)}
                        className="focus-visible:ring-primary rounded-md p-3.5 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${label} down in Saved Players`}
                        disabled={index === savedPlayers.length - 1 || pending}
                        onClick={() => onMove(index, index + 1)}
                        className="focus-visible:ring-primary rounded-md p-3.5 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </fieldset>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from Saved Players`}
                      disabled={pending}
                      onClick={() => onRemove(savedPlayer.brawlhallaId)}
                      className="focus-visible:ring-primary rounded-md p-3.5 text-red-300 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <RankedObservation savedPlayer={savedPlayer} />
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

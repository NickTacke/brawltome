'use client'

import { Avatar, AvatarFallback, AvatarImage, Card } from '@/components/ui'
import { fixEncoding } from '@/lib/utils'
import type { LeaderboardRecentActivityEntry, LeaderboardRecentActivityOutput } from '@brawltome/contracts'
import Link from 'next/link'
import {
  BRACKETS,
  type QueueFilters,
  REGIONS,
  buildQueueFilterQueryString,
  buildQueuePageQueryString,
  formatSignedDelta,
  playerHref,
} from './utils'

type AvailableActivity = Extract<LeaderboardRecentActivityOutput, { status: 'fresh' | 'stale' }>
type Contestant = LeaderboardRecentActivityEntry['identity'] extends infer Identity
  ? Identity extends { player: infer Player }
    ? Player
    : Identity extends { players: readonly (infer Player)[] }
      ? Player
      : never
  : never

function QueueHeader({ filters }: { filters: QueueFilters }) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Queue</h1>
      <QueueFiltersForm filters={filters} />
    </header>
  )
}

function QueueFiltersForm({ filters }: { filters: QueueFilters }) {
  return (
    <form action="/queue" method="get" className="flex gap-2">
      <p id="queue-filter-hint" className="sr-only">
        Selecting a value updates results automatically.
      </p>
      <label htmlFor="queue-mode" className="sr-only">
        Mode
      </label>
      <select
        id="queue-mode"
        name="mode"
        defaultValue={filters.mode}
        aria-describedby="queue-filter-hint"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-bold focus:outline-hidden focus:ring-2 focus:ring-ring"
      >
        {BRACKETS.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor="queue-region" className="sr-only">
        Region
      </label>
      <select
        id="queue-region"
        name="region"
        defaultValue={filters.region}
        aria-describedby="queue-filter-hint"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-9 min-w-32 rounded-md border border-input bg-background px-3 text-sm font-bold focus:outline-hidden focus:ring-2 focus:ring-ring"
      >
        {REGIONS.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-bold text-primary-foreground">
          Apply
        </button>
      </noscript>
    </form>
  )
}

function Player({ player }: { player: Contestant }) {
  const href = playerHref(player.brawlhallaId)
  const name = fixEncoding(player.name)
  const content = (
    <span className="inline-flex min-w-0 items-center gap-3 font-bold">
      {player.bestLegendNameKey && (
        <Avatar
          aria-label={`${name} best legend: ${player.bestLegendNameKey}`}
          className="h-12 w-12 shrink-0 rounded-xl"
        >
          <AvatarImage src={`/images/legends/avatars/${player.bestLegendNameKey}.png`} alt={player.bestLegendNameKey} />
          <AvatarFallback className="rounded-xl text-xs">
            {player.bestLegendNameKey.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <span className="truncate">{name}</span>
    </span>
  )
  return href ? (
    <Link href={href} prefetch={false} className="min-w-0 hover:text-primary">
      {content}
    </Link>
  ) : (
    content
  )
}

function Identity({ entry }: { entry: LeaderboardRecentActivityEntry }) {
  if (entry.identity.type !== 'fixed-two-vs-two-team') return <Player player={entry.identity.player} />
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <Player player={entry.identity.players[0]} />
      <span aria-hidden="true" className="text-muted-foreground">
        +
      </span>
      <Player player={entry.identity.players[1]} />
    </div>
  )
}

function ActivityMetrics({ entry }: { entry: LeaderboardRecentActivityEntry }) {
  const ratingDeltaColor = entry.ratingDelta > 0 ? 'text-success' : entry.ratingDelta < 0 ? 'text-danger' : ''
  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-border/50 pt-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Rating</p>
        <p className="text-3xl font-black tracking-tight">
          {entry.rating} <span className={`text-base ${ratingDeltaColor}`}>{formatSignedDelta(entry.ratingDelta)}</span>
        </p>
      </div>
      <div className="grid grid-cols-3 gap-5">
        {(
          [
            ['Games', entry.gamesDelta],
            ['Wins', entry.winsDelta],
            ['Losses', entry.lossesDelta],
          ] satisfies [string, number][]
        ).map(([label, value]) => (
          <div key={label} className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="font-black">{formatSignedDelta(value)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActivityRows({ entries }: { entries: LeaderboardRecentActivityEntry[] }) {
  return (
    <section aria-label="Recent ranked activity" className="grid gap-4 lg:grid-cols-2">
      {entries.map((entry) => (
        <article key={entryKey(entry)}>
          <Card className="h-full bg-linear-to-br from-card to-background p-5">
            <div className="flex items-start justify-between gap-4">
              <Identity entry={entry} />
              <div className="shrink-0 text-right text-xs font-bold text-muted-foreground">
                <p>#{entry.standing}</p>
                <p>{entry.region}</p>
              </div>
            </div>
            <ActivityMetrics entry={entry} />
          </Card>
        </article>
      ))}
    </section>
  )
}

function entryKey(entry: LeaderboardRecentActivityEntry): string {
  return entry.identity.type === 'fixed-two-vs-two-team'
    ? `${entry.identity.players[0].brawlhallaId}:${entry.identity.players[0].name}:${entry.identity.players[1].brawlhallaId}:${entry.identity.players[1].name}`
    : `${entry.identity.type}:${entry.identity.player.brawlhallaId}`
}

function Pagination({ view, filters }: { view: AvailableActivity; filters: QueueFilters }) {
  const previous =
    view.page > 1 ? `/queue?${buildQueuePageQueryString(filters, view.page - 1, view.currentSnapshotId)}` : undefined
  const next = view.hasMore
    ? `/queue?${buildQueuePageQueryString(filters, view.page + 1, view.currentSnapshotId)}`
    : undefined
  return (
    <nav aria-label="Queue pages" className="flex items-center justify-between">
      {previous ? (
        <Link href={previous} className="font-bold hover:text-primary">
          ← Previous
        </Link>
      ) : (
        <span aria-disabled="true" className="text-muted-foreground">
          ← Previous
        </span>
      )}
      <span className="text-sm text-muted-foreground">Page {view.page}</span>
      {next ? (
        <Link href={next} className="font-bold hover:text-primary">
          Next →
        </Link>
      ) : (
        <span aria-disabled="true" className="text-muted-foreground">
          Next →
        </span>
      )}
    </nav>
  )
}

export function QueueView({ view, filters }: { view: LeaderboardRecentActivityOutput; filters: QueueFilters }) {
  return (
    <div className="space-y-8 pb-10">
      <QueueHeader filters={filters} />
      {view.status === 'unavailable' ? (
        <Card className="p-6 text-center">
          <output>
            {view.reason === 'not_enough_history'
              ? 'Two completed official scans are needed before recent activity can be inferred.'
              : 'A scheduled scan interval was skipped, so this activity interval is unavailable.'}
          </output>
        </Card>
      ) : (
        <>
          {view.status === 'stale' && (
            <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
              Activity may be outdated.
            </p>
          )}
          {view.entries.length === 0 ? (
            <Card className="p-6 text-center">
              <output>
                {view.totalRows === 0 ? (
                  'No qualifying ranked activity was observed in this scan interval.'
                ) : (
                  <>No activity entries are available on this page. Use Previous to return to activity results.</>
                )}
              </output>
            </Card>
          ) : (
            <ActivityRows entries={view.entries} />
          )}
          <Pagination view={view} filters={filters} />
        </>
      )}
    </div>
  )
}

export function QueueLoadError({ filters }: { filters: QueueFilters }) {
  const query = filters.snapshotId
    ? buildQueuePageQueryString(filters, filters.page, filters.snapshotId)
    : buildQueueFilterQueryString(filters)
  return (
    <div className="space-y-8 pb-10">
      <QueueHeader filters={filters} />
      <Card role="alert" className="space-y-3 p-6 text-center">
        <p className="font-bold">Queue could not be loaded.</p>
        <p className="text-sm text-muted-foreground">The activity request failed. Try again in a moment.</p>
        <Link href={`/queue?${query}`} className="inline-block font-bold text-primary">
          Try again
        </Link>
      </Card>
    </div>
  )
}

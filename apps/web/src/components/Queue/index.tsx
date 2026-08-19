'use client'
import { legendAvatarUrl } from '@brawltome/game-data'

import { WinLossBar } from '@/components/player/shared'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
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
      <QueueFilterControls filters={filters} />
    </header>
  )
}

function QueueFilterControls({ filters }: { filters: QueueFilters }) {
  const navigate = (next: Partial<QueueFilters>) => {
    const query = buildQueueFilterQueryString({ ...filters, ...next, page: 1, snapshotId: undefined })
    window.location.assign(`/queue?${query}`)
  }
  return (
    <div className="flex gap-2">
      <p id="queue-filter-hint" className="sr-only">
        Selecting a value updates results automatically.
      </p>
      <Select value={filters.mode} onValueChange={(mode) => navigate({ mode: mode as QueueFilters['mode'] })}>
        <SelectTrigger aria-label="Queue mode" aria-describedby="queue-filter-hint" className="h-9 w-28 font-bold">
          <SelectValue>{BRACKETS.find(({ id }) => id === filters.mode)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-popover">
          {BRACKETS.map(({ id, label }) => (
            <SelectItem key={id} value={id} className="cursor-pointer">
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.region} onValueChange={(region) => navigate({ region: region as QueueFilters['region'] })}>
        <SelectTrigger aria-label="Queue region" aria-describedby="queue-filter-hint" className="h-9 w-36 font-bold">
          <SelectValue>{REGIONS.find(({ id }) => id === filters.region)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-popover">
          {REGIONS.map(({ id, label }) => (
            <SelectItem key={id} value={id} className="cursor-pointer">
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Player({ player }: { player: Contestant }) {
  const href = playerHref(player.brawlhallaId)
  const name = fixEncoding(player.name)
  const content = (
    <span className="flex min-h-12 min-w-0 flex-1 items-center gap-4 font-bold">
      {player.bestLegendNameKey && (
        <Avatar
          aria-label={`${name} best legend: ${player.bestLegendNameKey}`}
          className="h-12 w-12 shrink-0 border border-border bg-muted rounded-xl"
        >
          <AvatarImage
            src={legendAvatarUrl(player.bestLegendNameKey)}
            alt={player.bestLegendNameKey}
            className="object-cover object-top"
            loading="lazy"
          />
          <AvatarFallback className="rounded-xl text-xs font-bold text-muted-foreground">
            {player.bestLegendNameKey.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <span className="truncate text-xl font-black">{name}</span>
    </span>
  )
  return href ? (
    <Link href={href} prefetch={false} className="block min-w-0 flex-1 hover:text-primary">
      {content}
    </Link>
  ) : (
    content
  )
}

function Identity({ entry }: { entry: LeaderboardRecentActivityEntry }) {
  if (entry.identity.type !== 'fixed-two-vs-two-team') return <Player player={entry.identity.player} />
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex shrink-0 gap-1">
        {entry.identity.players.map((player) => {
          const name = fixEncoding(player.name)
          return (
            <Avatar
              key={`${player.brawlhallaId}:${player.name}`}
              aria-label={
                player.bestLegendNameKey
                  ? `${name} best legend: ${player.bestLegendNameKey}`
                  : `${name} best legend unavailable`
              }
              className="h-10 w-10 border border-border bg-muted rounded-lg"
            >
              {player.bestLegendNameKey && (
                <AvatarImage
                  src={legendAvatarUrl(player.bestLegendNameKey)}
                  alt={player.bestLegendNameKey}
                  className="object-cover object-top"
                  loading="lazy"
                />
              )}
              <AvatarFallback className="rounded-lg text-xs font-bold text-muted-foreground">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )
        })}
      </div>
      <ul aria-label="Team roster" className="min-w-0 flex-1 space-y-0.5">
        {entry.identity.players.map((player) => {
          const name = fixEncoding(player.name)
          const href = playerHref(player.brawlhallaId)
          return (
            <li key={`${player.brawlhallaId}:${player.name}`} className="min-w-0">
              {href ? (
                <Link href={href} prefetch={false} className="block truncate text-base font-black hover:text-primary">
                  {name}
                </Link>
              ) : (
                <span className="block truncate text-base font-black">{name}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ActivityMetrics({ entry }: { entry: LeaderboardRecentActivityEntry }) {
  const ratingDeltaColor = entry.ratingDelta > 0 ? 'text-success' : entry.ratingDelta < 0 ? 'text-danger' : ''
  const winRate = (entry.winsDelta / entry.gamesDelta) * 100
  return (
    <div className="mt-3 space-y-2 border-t border-border/50 pt-2">
      <div className="flex items-end justify-between gap-3">
        <div className="shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Rating</p>
          <p className="text-2xl font-black tracking-tight">
            {entry.rating} <span className={`text-sm ${ratingDeltaColor}`}>{formatSignedDelta(entry.ratingDelta)}</span>
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-x-2 text-right text-[10px] font-bold">
          <span className="whitespace-nowrap">
            {entry.winsDelta}W <span className="font-normal text-muted-foreground">({winRate.toFixed(1)}%)</span>
          </span>
          <span className="whitespace-nowrap">
            {entry.lossesDelta}L{' '}
            <span className="font-normal text-muted-foreground">({(100 - winRate).toFixed(1)}%)</span>
          </span>
        </div>
      </div>
      <WinLossBar percent={winRate} className="h-2" />
    </div>
  )
}

function ActivityRows({ entries }: { entries: LeaderboardRecentActivityEntry[] }) {
  return (
    <section aria-label="Recent ranked activity" className="grid min-w-0 gap-4 lg:grid-cols-2">
      {entries.map((entry) => (
        <article key={entryKey(entry)} className="min-w-0">
          <Card className="h-full min-w-0 bg-linear-to-br from-card to-background p-4">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <Identity entry={entry} />
              <div className="flex h-12 shrink-0 items-center gap-3 text-base font-black text-muted-foreground">
                <span>#{entry.standing}</span>
                <Badge variant="outline" className="text-sm">
                  {entry.region}
                </Badge>
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
              ? 'At least one hour of official scans is needed before recent activity can be inferred.'
              : 'A scheduled scan interval was skipped, so this activity interval is unavailable.'}
          </output>
        </Card>
      ) : (
        <>
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

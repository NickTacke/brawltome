import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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

const subtitle = 'Recent ranked activity inferred from leaderboard changes.'

function QueueHeader() {
  return (
    <header className="space-y-2">
      <h1 className="text-4xl font-black tracking-tight">Queue</h1>
      <p className="text-muted-foreground">{subtitle}</p>
    </header>
  )
}

function QueueFiltersForm({ filters }: { filters: QueueFilters }) {
  return (
    <form action="/queue" method="get" className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="space-y-2">
        <label htmlFor="queue-mode" className="block text-sm font-bold">
          Mode
        </label>
        <select
          id="queue-mode"
          name="mode"
          defaultValue={filters.mode}
          className="h-10 w-full rounded-md border border-border bg-background px-3"
        >
          {BRACKETS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="queue-region" className="block text-sm font-bold">
          Region
        </label>
        <select
          id="queue-region"
          name="region"
          defaultValue={filters.region}
          className="h-10 w-full rounded-md border border-border bg-background px-3"
        >
          {REGIONS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="h-10 rounded-md bg-primary px-5 font-bold text-primary-foreground">
        Apply filters
      </button>
    </form>
  )
}

function Player({ player }: { player: Contestant }) {
  const href = playerHref(player.brawlhallaId)
  const name = fixEncoding(player.name)
  const content = (
    <span className="inline-flex items-center gap-2 font-bold">
      {player.bestLegendNameKey && (
        <Avatar aria-label={`${name} best legend: ${player.bestLegendNameKey}`} className="h-8 w-8 rounded-md">
          <AvatarImage src={`/images/legends/avatars/${player.bestLegendNameKey}.png`} alt={player.bestLegendNameKey} />
          <AvatarFallback className="rounded-md text-xs">
            {player.bestLegendNameKey.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      {name}
    </span>
  )
  return href ? (
    <Link href={href} prefetch={false} className="hover:text-primary">
      {content}
    </Link>
  ) : (
    content
  )
}

function Identity({ entry }: { entry: LeaderboardRecentActivityEntry }) {
  if (entry.identity.type !== 'fixed-two-vs-two-team') return <Player player={entry.identity.player} />
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Player player={entry.identity.players[0]} />
        <span aria-hidden="true" className="text-muted-foreground">
          +
        </span>
        <Player player={entry.identity.players[1]} />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team activity</p>
    </div>
  )
}

function ActivityMetrics({ entry }: { entry: LeaderboardRecentActivityEntry }) {
  return (
    <div className="space-y-1">
      <p className="font-black">
        {entry.rating} <span className="text-sm text-muted-foreground">({formatSignedDelta(entry.ratingDelta)})</span>
      </p>
      <p className="text-sm text-muted-foreground">
        {formatSignedDelta(entry.gamesDelta)} games · {formatSignedDelta(entry.winsDelta)} W ·{' '}
        {formatSignedDelta(entry.lossesDelta)} L
      </p>
    </div>
  )
}

function ActivityRows({ entries }: { entries: LeaderboardRecentActivityEntry[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Standing</TableHead>
              <TableHead>Player or team</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Current rating and change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entryKey(entry)}>
                <TableCell>#{entry.standing}</TableCell>
                <TableCell>
                  <Identity entry={entry} />
                </TableCell>
                <TableCell>{entry.region}</TableCell>
                <TableCell>
                  <ActivityMetrics entry={entry} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 md:hidden">
        {entries.map((entry) => (
          <article key={entryKey(entry)} className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <Identity entry={entry} />
              <span className="text-sm text-muted-foreground">#{entry.standing}</span>
            </div>
            <ActivityMetrics entry={entry} />
            <p className="mt-2 text-xs text-muted-foreground">{entry.region}</p>
          </article>
        ))}
      </div>
    </>
  )
}

function entryKey(entry: LeaderboardRecentActivityEntry): string {
  return entry.identity.type === 'fixed-two-vs-two-team'
    ? `${entry.identity.players[0].brawlhallaId}:${entry.identity.players[0].name}:${entry.identity.players[1].brawlhallaId}:${entry.identity.players[1].name}`
    : `${entry.identity.type}:${entry.identity.player.brawlhallaId}`
}

function scanTime(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`
}

function ActivitySummary({ view }: { view: AvailableActivity }) {
  return (
    <div className="space-y-3 text-sm">
      {view.status === 'stale' && (
        <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
          This retained interval is stale. Its freshness window may have passed, a newer interval may exist, or
          collection may have failed.
        </p>
      )}
      <p>
        Scan interval: <time dateTime={view.previousObservedAt}>{scanTime(view.previousObservedAt)}</time> to{' '}
        <time dateTime={view.currentObservedAt}>{scanTime(view.currentObservedAt)}</time>.
      </p>
      <p className="text-muted-foreground">
        Showing {view.mode} · {REGIONS.find(({ id }) => id === view.region)?.label ?? view.region}, ordered by current
        rating.
      </p>
    </div>
  )
}

function Methodology({ view }: { view: AvailableActivity }) {
  return (
    <section
      aria-labelledby="queue-methodology"
      className="space-y-2 border-t border-border pt-5 text-sm text-muted-foreground"
    >
      <h2 id="queue-methodology" className="font-bold text-foreground">
        Methodology and coverage
      </h2>
      <p>
        Activity means a positive completed-game delta observed between two leaderboard scans and may lag real play.
        Collection is leaderboard-depth bounded to {view.provenance.pageDepth} source pages.
      </p>
      <p>
        Global is a locally deduplicated union of regional source scans. Scans run sequentially, normally every 15
        minutes, and may publish late. Identities crossing the collection-depth boundary are excluded.
      </p>
    </section>
  )
}

function Pagination({ view, filters }: { view: AvailableActivity; filters: QueueFilters }) {
  const previous =
    view.page > 1 ? `/queue?${buildQueuePageQueryString(filters, view.page - 1, view.currentSnapshotId)}` : undefined
  const next = view.hasMore
    ? `/queue?${buildQueuePageQueryString(filters, view.page + 1, view.currentSnapshotId)}`
    : undefined
  return (
    <nav aria-label="Queue pages" className="flex items-center justify-between border-t border-border pt-4">
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
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10">
      <QueueHeader />
      <Card className="space-y-6 p-6">
        <QueueFiltersForm filters={filters} />
        {view.status === 'unavailable' ? (
          <output className="block rounded-md border border-border bg-muted/30 p-6 text-center">
            {view.reason === 'not_enough_history'
              ? 'Two completed official scans are needed before recent activity can be inferred.'
              : 'A scheduled scan interval was skipped, so this activity interval is unavailable.'}
          </output>
        ) : (
          <>
            <ActivitySummary view={view} />
            {view.entries.length === 0 ? (
              <output className="block rounded-md border border-border bg-muted/30 p-6 text-center">
                {view.totalRows === 0 ? (
                  'No qualifying ranked activity was observed in this scan interval.'
                ) : (
                  <>No activity entries are available on this page. Use Previous to return to activity results.</>
                )}
              </output>
            ) : (
              <ActivityRows entries={view.entries} />
            )}
            <Pagination view={view} filters={filters} />
            <Methodology view={view} />
          </>
        )}
      </Card>
    </main>
  )
}

export function QueueLoadError({ filters }: { filters: QueueFilters }) {
  const query = filters.snapshotId
    ? buildQueuePageQueryString(filters, filters.page, filters.snapshotId)
    : buildQueueFilterQueryString(filters)
  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10">
      <QueueHeader />
      <Card role="alert" className="space-y-3 p-6 text-center">
        <p className="font-bold">Queue could not be loaded.</p>
        <p className="text-sm text-muted-foreground">The activity request failed. Try again in a moment.</p>
        <Link href={`/queue?${query}`} className="inline-block font-bold text-primary">
          Try again
        </Link>
      </Card>
    </main>
  )
}

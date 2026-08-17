import { describe, expect, test } from 'bun:test'
import type { LeaderboardRecentActivityOutput } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueueLoadError, QueueView } from '../../../src/components/Queue'
import type { QueueFilters } from '../../../src/components/Queue/utils'

const filters: QueueFilters = { mode: '1v1', region: 'EU', page: 1, snapshotId: undefined }
const base = {
  status: 'fresh' as const,
  mode: '1v1' as const,
  region: 'EU' as const,
  currentSnapshotId: '10000000-0000-4000-8000-000000000004',
  previousObservedAt: '2026-08-17T12:00:00Z',
  currentObservedAt: '2026-08-17T12:15:00Z',
  publishedAt: '2026-08-17T12:16:00Z',
  expectedNextPublicationAt: '2026-08-17T12:30:00Z',
  provenance: { source: 'brawlhalla-v1-ranked-leaderboard' as const, contractVersion: 2 as const, pageDepth: 20 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  totalRows: 1,
}
const metrics = {
  standing: 4,
  region: 'EU' as const,
  rating: 2300,
  ratingDelta: -12,
  winsDelta: 1,
  lossesDelta: 2,
  gamesDelta: 3,
}
const playerView = {
  ...base,
  entries: [
    {
      ...metrics,
      identity: {
        type: 'one-vs-one-player' as const,
        player: { brawlhallaId: 42, name: 'Ada', bestLegendNameKey: 'bodvar' },
      },
    },
  ],
} satisfies LeaderboardRecentActivityOutput

function render(view: LeaderboardRecentActivityOutput, currentFilters: QueueFilters = filters) {
  return renderToStaticMarkup(<QueueView view={view} filters={currentFilters} />)
}

describe('Queue activity presentation', () => {
  test('renders each inferred player activity once with rating-first metrics', () => {
    const html = render(playerView)
    expect(html).toContain('<h1')
    expect(html).toContain('Queue')
    expect(html.match(/href="\/player\/42"/g)).toHaveLength(1)
    expect(html).toContain('Ada')
    expect(html).toContain('bodvar')
    expect(html).not.toContain('recently active')
    expect(html).toContain('inline-flex items-center rounded-full border')
    expect(html).toContain('text-xl')
    expect(html).toContain('items-center gap-4 font-bold')
    expect(html).toContain('flex h-12 shrink-0 items-center gap-3 text-base font-black')
    expect(html).toContain('aria-label="Win rate 33.3%"')
    expect(html).toContain('2300')
    expect(html).toContain('-12')
    expect(html).toContain('1W')
    expect(html).toContain('(33.3%)')
    expect(html).toContain('2L')
    expect(html).toContain('(66.7%)')
    expect(html).not.toContain('+3 games')
    expect(html).not.toContain('+1W')
    expect(html).not.toContain('+2L')
    expect(html.toLowerCase()).not.toContain('online')
    expect(html.toLowerCase()).not.toContain('searching')
    expect(html.toLowerCase()).not.toContain('currently')
    expect(html.toLowerCase()).not.toContain('last seen')
  })

  test('places right-aligned W/L labels above the bar in a compact footer', () => {
    const html = render(playerView)
    expect(html.indexOf('1W')).toBeLessThan(html.indexOf('aria-label="Win rate 33.3%"'))
    expect(html).toContain('text-right text-[10px] font-bold')
    expect(html).toContain('mt-3 space-y-2 border-t border-border/50 pt-2')
  })

  test('renders fixed 2v2 as one team activity row with both linked teammates', () => {
    const view = {
      ...base,
      mode: '2v2' as const,
      entries: [
        {
          ...metrics,
          identity: {
            type: 'fixed-two-vs-two-team' as const,
            players: [
              {
                brawlhallaId: 42,
                name: 'Ada with an exceptionally long tournament name',
                bestLegendNameKey: 'mordex',
              },
              { brawlhallaId: 43, name: 'Bodvar with another exceptionally long tournament name' },
            ],
          },
        },
      ],
    } satisfies LeaderboardRecentActivityOutput
    const html = render(view, { ...filters, mode: '2v2' })
    expect(html.match(/href="\/player\/42"/g)).toHaveLength(1)
    expect(html.match(/href="\/player\/43"/g)).toHaveLength(1)
    expect(html).toContain('Ada with an exceptionally long tournament name')
    expect(html).toContain('Bodvar with another exceptionally long tournament name')
    expect(html).toContain('aria-label="Team roster"')
    expect(html).toContain('flex shrink-0 -space-x-3')
    expect(html.match(/h-10 w-10 rounded-lg ring-2 ring-card/g)).toHaveLength(2)
    expect(html).toContain('Bodvar with another exceptionally long tournament name best legend unavailable')
    expect(html).toContain('min-w-0 flex-1 space-y-0.5')
    expect(html.match(/block truncate text-base font-black hover:text-primary/g)).toHaveLength(2)
    expect(html.match(/href="\/player\/(42|43)"/g)).toHaveLength(2)
    expect(html).not.toContain('recently active')
    expect(html).toContain('aria-label="Win rate 33.3%"')
    expect(html).toContain('1W')
    expect(html).toContain('2L')
  })

  test('keeps stale, empty, history, gap, and transport failures distinct and accessible', () => {
    const stale = render({ ...playerView, status: 'stale' })
    expect(stale).toContain('role="alert"')
    expect(stale).toContain('Last activity scan: 2026-08-17 12:15 UTC.')
    expect(stale).not.toContain('Activity may be outdated')

    const empty = render({ ...base, totalRows: 0, entries: [] })
    expect(empty).toContain('No qualifying ranked activity was observed in this scan interval.')
    expect(empty).toContain('<output')

    const outOfRange = render({ ...base, page: 3, totalRows: 1, entries: [] })
    expect(outOfRange).toContain('No activity entries are available on this page.')
    expect(outOfRange).toContain('Use Previous to return to activity results.')
    expect(outOfRange).not.toContain('No qualifying ranked activity was observed')
    expect(outOfRange).toContain('<output')

    const history = render({
      status: 'unavailable',
      reason: 'not_enough_history',
      mode: '1v1',
      region: 'EU',
      page: 1,
      pageSize: 20,
    })
    expect(history).toContain('At least one hour of official scans is needed')
    expect(history).not.toContain('scan interval was skipped')

    const gap = render({
      status: 'unavailable',
      reason: 'scan_gap',
      mode: '1v1',
      region: 'EU',
      page: 1,
      pageSize: 20,
    })
    expect(gap).toContain('A scheduled scan interval was skipped')
    expect(gap).not.toContain('Two completed official scans are needed')

    const failure = renderToStaticMarkup(<QueueLoadError filters={filters} />)
    expect(failure).toContain('role="alert"')
    expect(failure).toContain('Queue could not be loaded')
    expect(failure).toContain('Try again')
    expect(failure).not.toContain('SELECT')
  })

  test('keeps activity cards shrinkable on narrow mobile viewports', () => {
    const html = render(playerView)
    expect(html).toContain('aria-label="Recent ranked activity" class="grid min-w-0')
    expect(html).toContain('<article class="min-w-0">')
    expect(html).toContain('h-full min-w-0')
    expect(html).toContain('flex min-w-0 items-start justify-between')
  })

  test('renders every approved filter and snapshot-pinned previous/next links', () => {
    const html = render(
      { ...playerView, page: 2, hasMore: true },
      { mode: '1v1', region: 'EU', page: 2, snapshotId: base.currentSnapshotId },
    )
    expect(html).toContain('<label for="queue-mode"')
    expect(html).toContain('<label for="queue-region"')
    for (const option of ['1v1', '2v2', 'solo2v2', '3v3']) expect(html).toContain(`value="${option}"`)
    for (const option of ['all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA']) {
      expect(html).toContain(`value="${option}"`)
    }
    expect(html.match(/scheme-light dark:scheme-dark/g)).toHaveLength(2)
    expect(html.match(/font-bold text-foreground scheme-light/g)).toHaveLength(2)
    expect(html).not.toContain('name="snapshotId"')
    expect(html).not.toContain('name="page"')
    expect(html).toContain(`href="/queue?mode=1v1&amp;region=EU&amp;page=1&amp;snapshotId=${base.currentSnapshotId}"`)
    expect(html).toContain(`href="/queue?mode=1v1&amp;region=EU&amp;page=3&amp;snapshotId=${base.currentSnapshotId}"`)
  })

  test('keeps filter submission available without client hydration', () => {
    const html = render(playerView)
    expect(html).toContain('<noscript><button type="submit"')
  })
})

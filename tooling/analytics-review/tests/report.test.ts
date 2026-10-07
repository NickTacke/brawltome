import { describe, expect, test } from 'bun:test'
import type { ReviewData } from '../src/queries'
import { buildReport } from '../src/report'

const empty: ReviewData = {
  searchMissRate: { current: 0.22, previous: 0.1 },
  searches: { current: 1200, previous: 900 },
  aliasSelectionShare: { current: 0.08, previous: null },
  refreshWaitP95Ms: { current: 12_000, previous: 15_000 },
  abandonedRefreshRate: { current: 0.03, previous: 0.04 },
  staleProfileShare: { current: 0.4, previous: 0.45 },
  staleRankedShare: { current: 0.35, previous: 0.4 },
  staleStatsShare: { current: 0.3, previous: 0.38 },
  backgroundRefreshes: { current: 6000, previous: null },
  lcpP75Ms: [{ route: '/player/[id]', device: 'mobile', value: 3_100 }],
  clientErrors: [{ kind: 'unhandled', route: '/', count: 12 }],
  trpcFailures: [],
  deadEnds: [{ kind: 'player_not_found', count: 30 }],
  topMissQueries: [{ query: 'boomie', count: 14 }],
  pageviewsByRoute: [{ route: '/player/[id]', count: 5000 }],
  features: [{ feature: 'pin', count: 40 }],
  referrers: [{ domain: 'google.com', count: 300 }],
  dailyUniques: [{ day: '2026-10-11', count: 800 }],
  verificationBacklog: [{ tier: 'other', value: 4200 }],
}

describe('buildReport', () => {
  test('flags threshold breaches in Top friction and shows period deltas', () => {
    const report = buildReport(empty, { days: 7, end: new Date('2026-10-12T00:00:00Z') })
    expect(report).toContain('# BrawlTome analytics review')
    const friction = report.split('## Top friction')[1].split('\n## ')[0]
    expect(friction).toContain('Search miss rate 22.0%')
    expect(friction).toContain('/player/[id] (mobile) LCP p75 3100 ms')
    expect(friction).not.toContain('Refresh wait')
    expect(report).toContain('boomie')
    expect(report).toMatch(/Search miss rate.*\+12\.0 pp/)
  })

  test('renders n/a when data is missing', () => {
    const report = buildReport(
      { ...empty, searchMissRate: { current: null, previous: null } },
      { days: 7, end: new Date() },
    )
    expect(report).toContain('n/a')
  })

  test('reports no friction when everything is within thresholds', () => {
    const calm: ReviewData = {
      ...empty,
      searchMissRate: { current: 0.05, previous: 0.05 },
      lcpP75Ms: [],
      clientErrors: [],
    }
    const report = buildReport(calm, { days: 7, end: new Date('2026-10-12T00:00:00Z') })
    expect(report.split('## Top friction')[1].split('\n## ')[0]).toContain('None above thresholds.')
  })
})

import type { PeriodValue, ReviewData } from './queries'

export const thresholds = { searchMissRate: 0.15, refreshWaitP95Ms: 30_000, abandonedRefreshRate: 0.1, lcpP75Ms: 2_500 }

const CLIENT_ERROR_THRESHOLD = 10
const DAY_MS = 86_400_000

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`)
const ms = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v)} ms`)
const num = (v: number | null) => (v === null ? 'n/a' : String(Math.round(v)))
const cell = (v: string) => v.replace(/\|/g, '\\|')

function ratioDelta({ current, previous }: PeriodValue): string {
  if (current === null || previous === null) return 'n/a'
  const pp = (current - previous) * 100
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(1)} pp`
}

function countDelta({ current, previous }: PeriodValue): string {
  if (current === null || previous === null || previous === 0) return 'n/a'
  const change = ((current - previous) / previous) * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_No data._'
  const line = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n')
}

function metricTable(rows: Array<[string, PeriodValue, (v: number | null) => string, (p: PeriodValue) => string]>) {
  return table(
    ['Metric', 'Current', 'Previous', 'Change'],
    rows.map(([name, value, format, delta]) => [name, format(value.current), format(value.previous), delta(value)]),
  )
}

function friction(data: ReviewData): string[] {
  const items: string[] = []
  const { searchMissRate, refreshWaitP95Ms, abandonedRefreshRate } = data
  if (searchMissRate.current !== null && searchMissRate.current > thresholds.searchMissRate)
    items.push(`Search miss rate ${pct(searchMissRate.current)} (threshold ${pct(thresholds.searchMissRate)})`)
  if (refreshWaitP95Ms.current !== null && refreshWaitP95Ms.current > thresholds.refreshWaitP95Ms)
    items.push(`Refresh wait p95 ${ms(refreshWaitP95Ms.current)} (threshold ${ms(thresholds.refreshWaitP95Ms)})`)
  if (abandonedRefreshRate.current !== null && abandonedRefreshRate.current > thresholds.abandonedRefreshRate)
    items.push(
      `Abandoned refresh rate ${pct(abandonedRefreshRate.current)} (threshold ${pct(thresholds.abandonedRefreshRate)})`,
    )
  for (const lcp of data.lcpP75Ms)
    if (lcp.value > thresholds.lcpP75Ms)
      items.push(
        `${lcp.route} (${lcp.device}) LCP p75 ${Math.round(lcp.value)} ms (threshold ${thresholds.lcpP75Ms} ms)`,
      )
  for (const error of data.clientErrors)
    if (error.count >= CLIENT_ERROR_THRESHOLD)
      items.push(`Client errors: ${error.kind} on ${error.route} x${Math.round(error.count)}`)
  return items
}

export function buildReport(data: ReviewData, meta: { days: number; end: Date }): string {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const start = new Date(meta.end.getTime() - meta.days * DAY_MS)
  const items = friction(data)

  const sections = [
    `# BrawlTome analytics review\n\n${day(start)} to ${day(meta.end)} (${meta.days} days), compared with the previous ${meta.days} days.`,
    `## Top friction\n\n${items.length ? items.map((i) => `- ${i}`).join('\n') : 'None above thresholds.'}`,
    `## Find\n\n${metricTable([
      ['Searches', data.searches, num, countDelta],
      ['Search miss rate', data.searchMissRate, pct, ratioDelta],
      ['Alias selection share', data.aliasSelectionShare, pct, ratioDelta],
    ])}\n\nTop no-result queries:\n\n${table(
      ['Query', 'Count'],
      data.topMissQueries.map((q) => [q.query, num(q.count)]),
    )}`,
    `## Fresh\n\n${metricTable([
      ['Stale profile views (12h+ old)', data.staleProfileShare, pct, ratioDelta],
      ['Stale ranked section (12h+ old)', data.staleRankedShare, pct, ratioDelta],
      ['Stale stats section (12h+ old)', data.staleStatsShare, pct, ratioDelta],
      ['Background refreshes', data.backgroundRefreshes, num, countDelta],
      ['Refresh wait p95', data.refreshWaitP95Ms, ms, countDelta],
      ['Abandoned refresh rate', data.abandonedRefreshRate, pct, ratioDelta],
    ])}`,
    `## Fast\n\nLCP p75 by route and device:\n\n${table(
      ['Route', 'Device', 'LCP p75'],
      data.lcpP75Ms.map((l) => [l.route, l.device, ms(l.value)]),
    )}`,
    `## Broken\n\nClient errors:\n\n${table(
      ['Kind', 'Route', 'Count'],
      data.clientErrors.map((e) => [e.kind, e.route, num(e.count)]),
    )}\n\ntRPC failures:\n\n${table(
      ['Procedure', 'Code', 'Count'],
      data.trpcFailures.map((f) => [f.procedure, f.code, num(f.count)]),
    )}\n\nDead ends:\n\n${table(
      ['Kind', 'Count'],
      data.deadEnds.map((d) => [d.kind, num(d.count)]),
    )}`,
    `## Usage\n\nPageviews by route:\n\n${table(
      ['Route', 'Pageviews'],
      data.pageviewsByRoute.map((p) => [p.route, num(p.count)]),
    )}\n\nFeature use:\n\n${table(
      ['Feature', 'Count'],
      data.features.map((f) => [f.feature, num(f.count)]),
    )}\n\nTop referrers:\n\n${table(
      ['Domain', 'Pageviews'],
      data.referrers.map((r) => [r.domain, num(r.count)]),
    )}\n\nDaily unique visitors:\n\n${table(
      ['Day', 'Visitors'],
      data.dailyUniques.map((u) => [u.day, num(u.count)]),
    )}`,
    `## Name verification\n\n${table(
      ['Tier', 'Backlog'],
      data.verificationBacklog.map((b) => [b.tier, num(b.value)]),
    )}`,
  ]
  return `${sections.join('\n\n')}\n`
}

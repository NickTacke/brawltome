import type { GrafanaApi, Sample } from './grafana'

export type PeriodValue = { current: number | null; previous: number | null }
export type ReviewData = {
  searchMissRate: PeriodValue
  searches: PeriodValue
  aliasSelectionShare: PeriodValue
  refreshWaitP95Ms: PeriodValue
  abandonedRefreshRate: PeriodValue
  staleProfileShare: PeriodValue // share of profile views with data_age 12h_7d or gt_7d
  lcpP75Ms: Array<{ route: string; device: string; value: number }>
  clientErrors: Array<{ kind: string; route: string; count: number }>
  trpcFailures: Array<{ procedure: string; code: string; count: number }>
  deadEnds: Array<{ kind: string; count: number }>
  topMissQueries: Array<{ query: string; count: number }>
  pageviewsByRoute: Array<{ route: string; count: number }>
  features: Array<{ feature: string; count: number }>
  referrers: Array<{ domain: string; count: number }>
  dailyUniques: Array<{ day: string; count: number }>
  verificationBacklog: Array<{ tier: string; value: number }>
}

const DAY_MS = 86_400_000
const byValueDesc = (a: Sample, b: Sample) => b.value - a.value
const label = (sample: Sample, key: string) => sample.metric[key] ?? ''

function ratio(numerator: string, denominator: string): string {
  return `sum(${numerator}) / clamp_min(sum(${denominator}), 1e-9)`
}

export async function collectReview(api: GrafanaApi, days: number, end: Date): Promise<ReviewData> {
  const w = `${days}d`
  const start = new Date(end.getTime() - days * DAY_MS)
  const first = async (query: string, time: Date): Promise<number | null> => {
    const [sample] = await api.promInstant(query, time)
    return sample && Number.isFinite(sample.value) ? sample.value : null
  }
  const period = async (query: string): Promise<PeriodValue> => {
    const [current, previous] = await Promise.all([first(query, end), first(query, start)])
    return { current, previous }
  }
  const abandonedRate = async (): Promise<PeriodValue> => {
    const at = async (time: Date): Promise<number | null> => {
      const [abandoned, completed] = await Promise.all([
        first(`sum(increase(analytics_refresh_abandoned_total[${w}]))`, time),
        first(`sum(increase(analytics_refresh_wait_ms_count[${w}]))`, time),
      ])
      if (abandoned === null && completed === null) return null
      const total = (abandoned ?? 0) + (completed ?? 0)
      return total > 0 ? (abandoned ?? 0) / total : null
    }
    const [current, previous] = await Promise.all([at(end), at(start)])
    return { current, previous }
  }
  const prom = (query: string) => api.promInstant(query, end)
  const loki = (query: string) => api.lokiInstant(query, end)

  const dayTimes = Array.from({ length: days }, (_, i) => new Date(end.getTime() - i * DAY_MS)).reverse()

  const [
    searchMissRate,
    searches,
    aliasSelectionShare,
    refreshWaitP95Ms,
    abandonedRefreshRate,
    staleProfileShare,
    lcp,
    clientErrors,
    trpcFailures,
    deadEnds,
    topMiss,
    pageviews,
    features,
    referrers,
    uniques,
    backlog,
  ] = await Promise.all([
    period(
      ratio(`increase(analytics_searches_total{outcome="miss"}[${w}])`, `increase(analytics_searches_total[${w}])`),
    ),
    period(`sum(increase(analytics_searches_total[${w}]))`),
    period(
      ratio(
        `increase(analytics_search_selections_total{via_alias="true"}[${w}])`,
        `increase(analytics_search_selections_total[${w}])`,
      ),
    ),
    period(`histogram_quantile(0.95, sum by (le) (increase(analytics_refresh_wait_ms_bucket[${w}])))`),
    abandonedRate(),
    period(
      ratio(
        `increase(analytics_profile_views_total{data_age=~"12h_7d|gt_7d"}[${w}])`,
        `increase(analytics_profile_views_total[${w}])`,
      ),
    ),
    prom(
      `histogram_quantile(0.75, sum by (le, route, device) (increase(analytics_web_vitals_bucket{name="LCP"}[${w}])))`,
    ),
    prom(`sum by (kind, route) (increase(analytics_client_errors_total[${w}]))`),
    prom(`sum by (procedure, code) (increase(analytics_trpc_failures_total[${w}]))`),
    prom(`sum by (kind) (increase(analytics_deadends_total[${w}]))`),
    loki(
      `topk(25, sum by (attributes_query) (count_over_time({service_name="web"} | json | event="analytics.search.performed" | attributes_results="0" [${w}])))`,
    ),
    prom(`sum by (route) (increase(analytics_pageviews_total[${w}]))`),
    prom(`sum by (feature) (increase(analytics_feature_use_total[${w}]))`),
    loki(
      `topk(20, sum by (attributes_referrerDomain) (count_over_time({service_name="web"} | json | event="analytics.pageview" | attributes_referrerDomain!="" [${w}])))`,
    ),
    Promise.all(
      dayTimes.map(async (time) => {
        const [sample] = await api.lokiInstant(
          `count(sum by (attributes_visitorKey) (count_over_time({service_name="web"} | json | event="analytics.pageview" [1d])))`,
          time,
        )
        return { day: new Date(time.getTime() - DAY_MS).toISOString().slice(0, 10), count: sample?.value ?? 0 }
      }),
    ),
    prom('sum by (tier) (player_name_verification_backlog)'),
  ])

  const counts = <T>(rows: Sample[], map: (row: Sample) => T) =>
    rows
      .filter((row) => Number.isFinite(row.value))
      .sort(byValueDesc)
      .map(map)

  return {
    searchMissRate,
    searches,
    aliasSelectionShare,
    refreshWaitP95Ms,
    abandonedRefreshRate,
    staleProfileShare,
    lcpP75Ms: counts(lcp, (r) => ({ route: label(r, 'route'), device: label(r, 'device'), value: r.value })),
    clientErrors: counts(clientErrors, (r) => ({ kind: label(r, 'kind'), route: label(r, 'route'), count: r.value })),
    trpcFailures: counts(trpcFailures, (r) => ({
      procedure: label(r, 'procedure'),
      code: label(r, 'code'),
      count: r.value,
    })),
    deadEnds: counts(deadEnds, (r) => ({ kind: label(r, 'kind'), count: r.value })),
    topMissQueries: counts(topMiss, (r) => ({ query: label(r, 'attributes_query'), count: r.value })),
    pageviewsByRoute: counts(pageviews, (r) => ({ route: label(r, 'route'), count: r.value })),
    features: counts(features, (r) => ({ feature: label(r, 'feature'), count: r.value })),
    referrers: counts(referrers, (r) => ({ domain: label(r, 'attributes_referrerDomain'), count: r.value })),
    dailyUniques: uniques,
    verificationBacklog: counts(backlog, (r) => ({ tier: label(r, 'tier'), value: r.value })),
  }
}

import type { SiteEventInputContract } from '@brawltome/contracts'
import type { Telemetry } from '@brawltome/telemetry'
import { scrubQuery } from '@brawltome/telemetry/analytics-labels'

type EventTelemetry = Pick<Telemetry, 'metrics' | 'logger'>
type SearchEvent<TName extends SiteEventInputContract['name']> = Extract<SiteEventInputContract, { name: TName }>

/** What every event's log line says about the tab it came from. */
export type EventTab = { visitId: string; route: string }

export function recordSearchPerformed(
  { metrics, logger }: EventTelemetry,
  tab: EventTab,
  event: SearchEvent<'search.performed'>,
): void {
  const { source, results, aliasResults, latencyMs } = event
  const outcome = results > 0 ? 'hit' : 'miss'

  metrics.add('analytics_searches_total', 1, { outcome, source })
  metrics.observe('analytics_search_latency_ms', latencyMs, { source })

  // the query only goes into the log, scrubbed, and never into a label
  const query = scrubQuery(event.query)

  logger.info('analytics.search.performed', { ...tab, source, query, results, aliasResults, latencyMs })
}

export function recordSearchFailed(
  { metrics, logger }: EventTelemetry,
  tab: EventTab,
  { source, latencyMs }: SearchEvent<'search.failed'>,
): void {
  metrics.add('analytics_searches_total', 1, { outcome: 'error', source })
  logger.info('analytics.search.failed', { ...tab, source, latencyMs })
}

export function recordSearchSelected(
  { metrics, logger }: EventTelemetry,
  tab: EventTab,
  { source, position, viaAlias }: SearchEvent<'search.selected'>,
): void {
  metrics.add('analytics_search_selections_total', 1, { via_alias: String(viaAlias), source })
  logger.info('analytics.search.selected', { ...tab, source, position, viaAlias })
}

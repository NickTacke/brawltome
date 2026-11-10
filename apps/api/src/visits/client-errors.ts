import type { SiteEventInputContract } from '@brawltome/contracts'
import type { Telemetry } from '@brawltome/telemetry'
import { scrubError } from '@brawltome/telemetry/analytics-labels'
import type { EventTab } from './search-events'

type ClientErrorEvent = Extract<SiteEventInputContract, { name: 'error.client' }>

/** One error in a visitor's browser: counted by kind and route, with its message in the log for whoever fixes it. */
export function recordClientError(
  { metrics, logger }: Pick<Telemetry, 'metrics' | 'logger'>,
  tab: EventTab,
  { kind, message }: ClientErrorEvent,
): void {
  metrics.add('analytics_client_errors_total', 1, { kind, route: tab.route })

  // the message only goes into the log, scrubbed, and never into a label
  logger.info('analytics.error.client', { ...tab, kind, message: scrubError(message) })
}

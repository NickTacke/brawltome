import type { SiteEventInputContract } from '@brawltome/contracts'
import type { Telemetry } from '@brawltome/telemetry'
import type { EventTab } from './search-events'
import { deviceOf } from './visit-labels'

type WebVitalEvent = Extract<SiteEventInputContract, { name: 'vitals' }>

/** One web vital of a page load, as a sample for the loading speed panels. Nothing is logged for it. */
export function recordWebVital({ metrics }: Pick<Telemetry, 'metrics'>, tab: EventTab, event: WebVitalEvent): void {
  const device = deviceOf(event.viewportWidth)

  metrics.observe('analytics_web_vitals', event.value, { name: event.metric, route: tab.route, device })
}

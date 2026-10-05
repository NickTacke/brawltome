import type { Telemetry } from '@brawltome/telemetry'
import { analyticsTrpcCode, analyticsTrpcProcedure } from '@brawltome/telemetry/analytics-labels'
import { z } from 'zod'
import { scrubError, scrubQuery } from './labels'
import type { createTabRateLimiter } from './rate-limit'
import type { createDailySalt } from './salt'
import { type AnalyticsEvent, analyticsEventSchema } from './schema'

type IngestDeps = {
  telemetry: Pick<Telemetry, 'metrics' | 'logger'>
  salt: ReturnType<typeof createDailySalt>
  limiter: ReturnType<typeof createTabRateLimiter>
}

const envelopeSchema = z.object({ events: z.array(z.unknown()).min(1).max(60) })

const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T =>
  (list as readonly string[]).includes(value) ? (value as T) : fallback

function record(event: AnalyticsEvent, visitorKey: () => string, { telemetry }: IngestDeps): void {
  const { metrics, logger } = telemetry
  const { tabId, route, device } = event
  const log = (attrs: Record<string, string | number | boolean>) =>
    logger.info(`analytics.${event.name}`, { tabId, route, ...attrs })
  switch (event.name) {
    case 'pageview':
      metrics.add('analytics_pageviews_total', 1, { route, device })
      log({
        device,
        viewport: event.viewport,
        visitorKey: visitorKey(),
        referrerDomain: event.referrerDomain ?? '',
      })
      return
    case 'search.performed':
      metrics.add('analytics_searches_total', 1, { outcome: event.results > 0 ? 'hit' : 'miss', source: event.source })
      metrics.observe('analytics_search_latency_ms', event.latencyMs, { source: event.source })
      log({
        source: event.source,
        query: scrubQuery(event.query),
        results: event.results,
        aliasResults: event.aliasResults,
        latencyMs: event.latencyMs,
      })
      return
    case 'search.failed':
      metrics.add('analytics_searches_total', 1, { outcome: 'error', source: event.source })
      log({ source: event.source, latencyMs: event.latencyMs })
      return
    case 'search.selected':
      metrics.add('analytics_search_selections_total', 1, { via_alias: String(event.viaAlias), source: event.source })
      log({ source: event.source, position: event.position, viaAlias: event.viaAlias })
      return
    case 'profile.viewed':
      metrics.add('analytics_profile_views_total', 1, { data_age: event.dataAge })
      log({ dataAge: event.dataAge })
      return
    case 'refresh.state':
      metrics.add('analytics_refresh_states_total', 1, { state: event.state })
      log({ state: event.state })
      return
    case 'refresh.completed':
      metrics.observe('analytics_refresh_wait_ms', event.waitMs, {})
      metrics.add('analytics_refresh_retries_total', event.retries, {})
      log({ waitMs: event.waitMs, retries: event.retries })
      return
    case 'refresh.abandoned':
      metrics.add('analytics_refresh_abandoned_total', 1, {})
      log({ waitedMs: event.waitedMs })
      return
    case 'vitals':
      metrics.observe('analytics_web_vitals', event.value, { name: event.metric, route, device })
      return
    case 'error.client':
      metrics.add('analytics_client_errors_total', 1, { kind: event.kind, route })
      log({ kind: event.kind, message: scrubError(event.message) })
      return
    case 'trpc.failed': {
      const procedure = oneOf(analyticsTrpcProcedure, event.procedure, 'other')
      const code = oneOf(analyticsTrpcCode, event.code, 'OTHER')
      metrics.add('analytics_trpc_failures_total', 1, { procedure, code })
      log({ procedure, code })
      return
    }
    case 'deadend':
      metrics.add('analytics_deadends_total', 1, { kind: event.kind, route })
      log({ kind: event.kind })
      return
    case 'feature.used':
      metrics.add('analytics_feature_use_total', 1, { feature: event.feature })
      log({ feature: event.feature })
      return
  }
}

export function ingestBatch(input: { body: unknown; ip: string; userAgent: string }, deps: IngestDeps): void {
  const { metrics } = deps.telemetry
  try {
    const parsed = envelopeSchema.safeParse(input.body)
    if (!parsed.success) {
      const tooMany = parsed.error.issues.some((issue) => issue.code === 'too_big' && issue.path[0] === 'events')
      metrics.add('analytics_events_dropped_total', 1, { reason: tooMany ? 'too_many' : 'invalid' })
      return
    }
    const events: AnalyticsEvent[] = []
    let invalid = 0
    for (const candidate of parsed.data.events) {
      const result = analyticsEventSchema.safeParse(candidate)
      if (result.success) events.push(result.data)
      else invalid += 1
    }
    if (invalid > 0) metrics.add('analytics_events_dropped_total', invalid, { reason: 'invalid' })
    if (events.length === 0) return
    if (!deps.limiter.allow(events[0].tabId)) {
      metrics.add('analytics_events_dropped_total', events.length, { reason: 'rate_limited' })
      return
    }
    for (const event of events) record(event, () => deps.salt.visitorKey(input.ip, input.userAgent), deps)
  } catch {
    try {
      metrics.add('analytics_events_dropped_total', 1, { reason: 'invalid' })
    } catch {}
  }
}

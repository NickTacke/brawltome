import { describe, expect, test } from 'bun:test'
import { runJobOnce } from '@brawltome/queue/testing'
import { createTelemetry } from '@brawltome/telemetry'
import {
  createStatisticsLegendMetaPublicationJob,
  type StatisticsLegendMetaPublicationJobDependencies,
} from '../../jobs/statistics-legend-meta-publication-job'
import { createQueueSpy, statisticsLease } from './job-fixtures'

const generationId = '10000000-0000-4000-8000-000000000001'

function legendMetaLease() {
  return statisticsLease('statistics-legend-meta-publication', { generationId })
}

type StatisticsStub = Partial<StatisticsLegendMetaPublicationJobDependencies['statistics']>

function createJob(statistics: StatisticsStub = {}) {
  return createStatisticsLegendMetaPublicationJob({
    statistics: {
      preflightLegendMetaPublication: async () => 'missing',
      buildAndPublishLegendMeta: async () => ({ result: 'applied', decision: null }),
      ...statistics,
    } as StatisticsLegendMetaPublicationJobDependencies['statistics'],
  })
}

const legendMetaConflict = {
  code: 'statistics_legend_meta_effect_conflict',
  message: 'Statistics Legend Meta publication identity conflicts',
  retryable: false,
}

describe('statistics legend meta publication job', () => {
  test('dispatches the fenced Legend Meta publication without treating it as source collection', async () => {
    let built = false
    const spy = createQueueSpy(legendMetaLease())

    const job = createJob({
      preflightLegendMetaPublication: async () => 'missing' as const,
      buildAndPublishLegendMeta: async () => {
        built = true

        return { result: 'applied' as const, decision: null }
      },
    })

    expect(await runJobOnce(spy.queue as never, job)).toBe('succeeded')
    expect(built).toBe(true)
    expect(spy.completions()).toBe(1)
  })

  test('reports Legend Meta execution and lease-loss failures through bounded telemetry', async () => {
    for (const [transition, expectedCategory] of [
      ['transitioned', 'execution'],
      ['lease-lost', 'lease_lost'],
    ] as const) {
      const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
      const spy = createQueueSpy(legendMetaLease(), { transition })

      const job = createJob({
        preflightLegendMetaPublication: async () => 'missing' as const,
        buildAndPublishLegendMeta: async () => {
          throw new Error('Legend Meta publication failed')
        },
      })

      await runJobOnce(spy.queue as never, job, { telemetry, retryDelayMs: 10 })

      const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')

      expect(failures?.series[0]?.labels).toEqual({
        kind: 'statistics-legend-meta-publication',
        failure_category: expectedCategory,
      })

      expect(telemetry.stats().seriesDropped).toBe(0)
    }
  })

  test('stops when the renewal is lost', async () => {
    const spy = createQueueSpy(legendMetaLease(), { renewals: ['lease-lost'] })

    const job = createJob({
      preflightLegendMetaPublication: async () => {
        throw new Error('the preflight must not run')
      },
    })

    expect(await runJobOnce(spy.queue as never, job)).toBe('lease_lost')
  })

  test('an already applied publication completes without building', async () => {
    const spy = createQueueSpy(legendMetaLease())

    const job = createJob({
      preflightLegendMetaPublication: async () => 'already-applied',
      buildAndPublishLegendMeta: async () => {
        throw new Error('must not build again')
      },
    })

    expect(await runJobOnce(spy.queue as never, job)).toBe('succeeded')
    expect(spy.completions()).toBe(1)
  })

  test('identity conflicts dead-letter with the Legend Meta code', async () => {
    const preflightSpy = createQueueSpy(legendMetaLease())
    const buildSpy = createQueueSpy(legendMetaLease())

    expect(
      await runJobOnce(
        preflightSpy.queue as never,
        createJob({ preflightLegendMetaPublication: async () => 'effect-conflict' }),
      ),
    ).toBe('dead_letter')

    expect(
      await runJobOnce(
        buildSpy.queue as never,
        createJob({ buildAndPublishLegendMeta: async () => ({ result: 'effect-conflict', decision: null }) }),
      ),
    ).toBe('dead_letter')

    expect(preflightSpy.failures).toEqual([{ failure: legendMetaConflict, retryDelayMs: 0 }])
    expect(buildSpy.failures).toEqual([{ failure: legendMetaConflict, retryDelayMs: 0 }])
  })

  test('a missing prerequisite defers by the retry delay', async () => {
    const spy = createQueueSpy(legendMetaLease())

    const job = createJob({
      buildAndPublishLegendMeta: async () => ({ result: 'prerequisite-missing', decision: null }),
    })

    expect(await runJobOnce(spy.queue as never, job, { retryDelayMs: 17 })).toBe('retry')

    expect(spy.deferrals).toEqual([
      {
        failure: {
          code: 'statistics_legend_meta_prerequisite_missing',
          message: 'Statistics ranked validation decision is not available yet',
          retryable: true,
        },
        retryDelayMs: 17,
      },
    ])
  })

  test('a lost lease when building ends the attempt', async () => {
    const spy = createQueueSpy(legendMetaLease())
    const job = createJob({ buildAndPublishLegendMeta: async () => ({ result: 'lease-lost', decision: null }) })

    expect(await runJobOnce(spy.queue as never, job)).toBe('lease_lost')
    expect(spy.completions()).toBe(0)
  })

  test('a thrown error fails with the Legend Meta publication code', async () => {
    const spy = createQueueSpy(legendMetaLease())

    const job = createJob({
      preflightLegendMetaPublication: async () => {
        throw new Error('execution failed')
      },
    })

    await runJobOnce(spy.queue as never, job, { retryDelayMs: 10 })

    expect(spy.failures).toEqual([
      {
        failure: { code: 'statistics_legend_meta_publication_failed', message: 'execution failed', retryable: true },
        retryDelayMs: 10,
      },
    ])
  })
})

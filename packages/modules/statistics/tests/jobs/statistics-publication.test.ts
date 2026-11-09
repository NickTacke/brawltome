import { describe, expect, test } from 'bun:test'
import { runJobOnce } from '@brawltome/queue/testing'
import {
  createStatisticsPublicationJob,
  type StatisticsPublicationJobDependencies,
} from '../../jobs/statistics-publication-job'
import { createQueueSpy, statisticsLease } from './job-fixtures'

const generationId = '10000000-0000-4000-8000-000000000001'

function publicationLease() {
  return statisticsLease('statistics-publication', { generationId, product: 'ranked' })
}

type StatisticsStub = Partial<StatisticsPublicationJobDependencies['statistics']>

function createJob(statistics: StatisticsStub = {}) {
  return createStatisticsPublicationJob({
    statistics: {
      preflightPublication: async () => 'missing',
      validateAndPublish: async () => ({ result: 'applied', decision: null }),
      ...statistics,
    } as StatisticsPublicationJobDependencies['statistics'],
  })
}

const publicationConflict = {
  code: 'statistics_effect_conflict',
  message: 'Statistics publication identity conflicts',
  retryable: false,
}

describe('statistics publication job', () => {
  test('publishes and completes', async () => {
    const authorizations: unknown[] = []
    const spy = createQueueSpy(publicationLease())

    const job = createJob({
      validateAndPublish: async (authorization) => {
        authorizations.push(authorization)

        return { result: 'applied', decision: null }
      },
    })

    expect(await runJobOnce(spy.queue as never, job)).toBe('succeeded')
    expect(spy.completions()).toBe(1)

    expect(authorizations).toMatchObject([{ kind: 'statistics-publication', generationId, product: 'ranked' }])
  })

  test('stops when the renewal is lost, before reading anything', async () => {
    const spy = createQueueSpy(publicationLease(), { renewals: ['lease-lost'] })

    const job = createJob({
      preflightPublication: async () => {
        throw new Error('the preflight must not run')
      },
    })

    expect(await runJobOnce(spy.queue as never, job)).toBe('lease_lost')
  })

  test('an already applied publication completes without publishing', async () => {
    const spy = createQueueSpy(publicationLease())

    const job = createJob({
      preflightPublication: async () => 'already-applied',
      validateAndPublish: async () => {
        throw new Error('must not publish again')
      },
    })

    expect(await runJobOnce(spy.queue as never, job)).toBe('succeeded')
    expect(spy.completions()).toBe(1)
  })

  test('a preflight conflict dead-letters at once', async () => {
    const spy = createQueueSpy(publicationLease())
    const job = createJob({ preflightPublication: async () => 'effect-conflict' })

    expect(await runJobOnce(spy.queue as never, job)).toBe('dead_letter')
    expect(spy.failures).toEqual([{ failure: publicationConflict, retryDelayMs: 0 }])
  })

  test('a publish conflict dead-letters at once', async () => {
    const spy = createQueueSpy(publicationLease())
    const job = createJob({ validateAndPublish: async () => ({ result: 'effect-conflict', decision: null }) })

    expect(await runJobOnce(spy.queue as never, job)).toBe('dead_letter')
    expect(spy.failures).toEqual([{ failure: publicationConflict, retryDelayMs: 0 }])
  })

  test('active collections defer the publication by the retry delay', async () => {
    const spy = createQueueSpy(publicationLease())
    const job = createJob({ validateAndPublish: async () => ({ result: 'collection-active', decision: null }) })

    expect(await runJobOnce(spy.queue as never, job, { retryDelayMs: 17 })).toBe('retry')

    expect(spy.deferrals).toEqual([
      {
        failure: {
          code: 'statistics_collection_active',
          message: 'Statistics collection replay is still active',
          retryable: true,
        },
        retryDelayMs: 17,
      },
    ])
  })

  test('a lost lease when publishing ends the attempt', async () => {
    const spy = createQueueSpy(publicationLease())
    const job = createJob({ validateAndPublish: async () => ({ result: 'lease-lost', decision: null }) })

    expect(await runJobOnce(spy.queue as never, job)).toBe('lease_lost')
    expect(spy.completions()).toBe(0)
  })

  test('a thrown error fails with the publication code', async () => {
    const spy = createQueueSpy(publicationLease())

    const job = createJob({
      preflightPublication: async () => {
        throw new Error('execution failed')
      },
    })

    await runJobOnce(spy.queue as never, job, { retryDelayMs: 10 })

    expect(spy.failures).toEqual([
      {
        failure: { code: 'statistics_publication_failed', message: 'execution failed', retryable: true },
        retryDelayMs: 10,
      },
    ])
  })
})

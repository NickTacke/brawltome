import { describe, expect, test } from 'bun:test'
import { createTelemetry } from '@brawltome/telemetry'
import { searchRouter } from '../src/router/search.router'
import type { Context } from '../src/trpc/context'

describe('search.local', () => {
  test('records search_requests_total as miss for empty results and hit otherwise', async () => {
    const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
    const results = [
      { players: [], clans: [] },
      {
        players: [
          {
            brawlhallaId: 1,
            name: 'Ada',
            region: 'US-E',
            rating: null,
            viewCount: 0,
            bestLegendNameKey: null,
            matchedAlias: null,
          },
        ],
        clans: [],
      },
    ]
    let call = 0
    const caller = searchRouter.createCaller({
      telemetry,
      discoveryQueries: { search: async () => results[call++] },
    } as unknown as Context)

    await caller.local({ query: 'nobody' })
    await caller.local({ query: 'ada' })

    const counter = telemetry.metrics.snapshot().find(({ name }) => name === 'search_requests_total')
    expect(Object.fromEntries((counter?.series ?? []).map(({ labels, value }) => [labels.outcome, value]))).toEqual({
      hit: 1,
      miss: 1,
    })
  })
})

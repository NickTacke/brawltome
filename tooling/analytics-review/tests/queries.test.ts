import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import type { GrafanaApi } from '../src/grafana'
import { resolveOutputPath } from '../src/output-path'
import { collectReview } from '../src/queries'

type Call = { query: string; time: Date }

function fakeApi(answer: (query: string, time: Date) => number | null | undefined) {
  const calls: Call[] = []
  const respond = async (query: string, time: Date) => {
    calls.push({ query, time })
    const value = answer(query, time)
    return value === undefined ? [] : [{ metric: {}, value: value as number }]
  }
  const api: GrafanaApi = { promInstant: respond, lokiInstant: async () => [] }
  return { api, calls }
}

const end = new Date('2026-10-12T00:00:00Z')
const DAY = 86_400_000

describe('collectReview', () => {
  test('computes abandoned rate as abandoned / (abandoned + completed)', async () => {
    const { api } = fakeApi((q) => (q.includes('abandoned') ? 10 : q.includes('wait_ms_count') ? 90 : undefined))
    const data = await collectReview(api, 7, end)
    expect(data.abandonedRefreshRate.current).toBe(0.1)
  })

  test('computes miss rate as miss / (hit + miss), excluding errors', async () => {
    const { api, calls } = fakeApi(() => 1)
    await collectReview(api, 7, end)
    const query = calls.find((c) => c.query.includes('outcome="miss"'))?.query
    expect(query).toContain('outcome=~"hit|miss"')
    expect(query).not.toContain('analytics_searches_total[')
  })

  test('evaluates previous period at end - days', async () => {
    const { api, calls } = fakeApi((q, t) =>
      q.includes('abandoned')
        ? t.getTime() === end.getTime()
          ? 10
          : 30
        : q.includes('wait_ms_count')
          ? 90
          : undefined,
    )
    const data = await collectReview(api, 7, end)
    const previousTime = new Date(end.getTime() - 7 * DAY).getTime()
    expect(calls.some((c) => c.time.getTime() === previousTime)).toBe(true)
    expect(data.abandonedRefreshRate.previous).toBe(0.25)
  })

  test('maps missing and NaN results to null', async () => {
    const missing = await collectReview(fakeApi(() => undefined).api, 7, end)
    expect(missing.abandonedRefreshRate).toEqual({ current: null, previous: null })
    expect(missing.searchMissRate).toEqual({ current: null, previous: null })
    const nan = await collectReview(fakeApi(() => Number.NaN).api, 7, end)
    expect(nan.searchMissRate).toEqual({ current: null, previous: null })
    expect(nan.abandonedRefreshRate).toEqual({ current: null, previous: null })
  })
})

describe('daily uniques', () => {
  test('evaluates each complete UTC day at its midnight boundary and excludes the partial day', async () => {
    const lokiCalls: Call[] = []
    const api: GrafanaApi = {
      promInstant: async () => [],
      lokiInstant: async (query, time) => {
        lokiCalls.push({ query, time })
        return query.includes('visitorKey') ? [{ metric: {}, value: time.getUTCDate() }] : []
      },
    }
    const midday = new Date('2026-10-12T15:30:00Z')
    const data = await collectReview(api, 3, midday)
    const uniqueCalls = lokiCalls.filter((c) => c.query.includes('visitorKey'))
    expect(uniqueCalls.map((c) => c.time.toISOString()).sort()).toEqual([
      '2026-10-10T00:00:00.000Z',
      '2026-10-11T00:00:00.000Z',
      '2026-10-12T00:00:00.000Z',
    ])
    expect(uniqueCalls.every((c) => c.query.includes('[1d]'))).toBe(true)
    expect(data.dailyUniques).toEqual([
      { day: '2026-10-09', count: 10 },
      { day: '2026-10-10', count: 11 },
      { day: '2026-10-11', count: 12 },
    ])
  })
})

describe('resolveOutputPath', () => {
  test('resolves default and relative paths against the base dir, keeps absolute', () => {
    expect(resolveOutputPath(undefined, end, '/work')).toBe('/work/analytics-review-2026-10-12.md')
    expect(resolveOutputPath('out/r.md', end, '/work')).toBe(resolve('/work', 'out/r.md'))
    expect(resolveOutputPath('/abs/r.md', end, '/work')).toBe('/abs/r.md')
  })
})

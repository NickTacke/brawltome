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

describe('resolveOutputPath', () => {
  test('resolves default and relative paths against the base dir, keeps absolute', () => {
    expect(resolveOutputPath(undefined, end, '/work')).toBe('/work/analytics-review-2026-10-12.md')
    expect(resolveOutputPath('out/r.md', end, '/work')).toBe(resolve('/work', 'out/r.md'))
    expect(resolveOutputPath('/abs/r.md', end, '/work')).toBe('/abs/r.md')
  })
})

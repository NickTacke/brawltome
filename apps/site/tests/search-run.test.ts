import { describe, expect, test } from 'bun:test'
import { runSearch, type SearchAnswer } from '../src/components/search/search-run'
import type { SearchResults } from '../src/server/search'

const results: SearchResults = {
  players: [],
  guilds: [{ clanId: 9, clanName: 'Valhalla', clanXp: '1000', memberCount: 12 }],
}

type FakeOptions = { search?: () => Promise<SearchResults>; isStale?: boolean; isCounted?: boolean }

// the clock moves 180 ms between the question and the answer
function fakeRun({ search = async () => results, isStale = false, isCounted = true }: FakeOptions = {}) {
  const shown: SearchAnswer[] = []
  const reports: unknown[][] = []
  const times = [1_000, 1_180]

  const reporter = {
    performed: (...report: unknown[]) => reports.push(['performed', ...report]),
    failed: (...report: unknown[]) => reports.push(['failed', ...report]),
    selected: () => undefined,
  }

  const run = {
    term: 'valh',
    search,
    nowMs: () => times.shift() ?? 0,
    isStale: () => isStale,
    show: (answer: SearchAnswer) => shown.push(answer),
    reporter: isCounted ? reporter : null,
  }

  return { run, shown, reports }
}

describe('runSearch', () => {
  test('shows the answer and reports the search once, with the time it took', async () => {
    const fake = fakeRun()

    await runSearch(fake.run)

    expect(fake.shown).toEqual([{ status: 'done', results }])
    expect(fake.reports).toEqual([['performed', 'valh', results, 180]])
  })

  test('a search that fails shows that and is reported as failed', async () => {
    const fake = fakeRun({ search: () => Promise.reject(new Error('search failed')) })

    await runSearch(fake.run)

    expect(fake.shown).toEqual([{ status: 'failed', results: { players: [], guilds: [] } }])
    expect(fake.reports).toEqual([['failed', 180]])
  })

  test('an answer that newer text has replaced is neither shown nor reported', async () => {
    const fake = fakeRun({ isStale: true })

    await runSearch(fake.run)

    expect(fake.shown).toEqual([])
    expect(fake.reports).toEqual([])
  })

  test('a visitor we may not count still gets the answer', async () => {
    const fake = fakeRun({ isCounted: false })

    await runSearch(fake.run)

    expect(fake.shown).toEqual([{ status: 'done', results }])
    expect(fake.reports).toEqual([])
  })
})

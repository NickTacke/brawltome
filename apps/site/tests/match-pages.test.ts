import { describe, expect, test } from 'bun:test'
import type { MatchSummaryContract } from '@brawltome/contracts'
import { joinPages, withNextPage } from '../src/components/matches/match-pages'

// only the id matters to how pages join
const match = (id: string) => ({ id }) as MatchSummaryContract
const ids = (matches: MatchSummaryContract[]) => matches.map((shown) => shown.id)

const rows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => match(`m${from + index}`))

describe('pages loaded with show more', () => {
  const firstPage = { matches: rows(1, 20), nextCursor: 'after-20' }
  const secondPage = { matches: rows(21, 40), nextCursor: 'after-40' }

  test('follow the first page, and continue from the last one loaded', () => {
    const loaded = withNextPage(firstPage, secondPage)
    const shown = joinPages(firstPage, loaded)

    expect(ids(shown.matches)).toEqual(ids(rows(1, 40)))
    expect(shown.nextCursor).toBe('after-40')
  })

  // a match read while the visitor looks pushes the old first page's last match off the new first page
  test('keep a match a newer first page pushed off', () => {
    const loaded = withNextPage(firstPage, secondPage)
    const refreshed = { matches: [match('new'), ...rows(1, 19)], nextCursor: 'after-19' }

    const shown = joinPages(refreshed, loaded)

    expect(ids(shown.matches)).toEqual(['new', ...ids(rows(1, 40))])
    expect(shown.nextCursor).toBe('after-40')
  })

  test('without any loaded, the first page is all there is', () => {
    expect(joinPages(firstPage, null)).toBe(firstPage)
  })
})

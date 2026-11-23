import { describe, expect, test } from 'bun:test'
import { fitForVisitor } from '../jobs/visitor-refresh-takeover'

const coverage = { cohort: 'ranked-coverage', brawlhallaId: 7, staleSections: ['ranked'] }
const recentlyViewed = { cohort: 'recently-viewed', brawlhallaId: 7, staleSections: ['ranked', 'stats'] }
const primary = { assignmentId: 'assignment', brawlhallaId: 7, staleSections: ['ranked', 'stats'] }

describe('visitor fit', () => {
  test('takes over a queued coverage refresh as interactive work with the sections joined and no cohort', () => {
    expect(fitForVisitor({ workClass: 'primary-monitoring', status: 'pending', payload: coverage }, ['stats'])).toEqual(
      {
        action: 'take-over',
        workClass: 'interactive',
        payload: { brawlhallaId: 7, staleSections: ['ranked', 'stats'] },
      },
    )
  })

  test('attaches to a queued background refresh that already covers, leaving it as it is', () => {
    const queuedRecentlyViewed = {
      workClass: 'primary-monitoring' as const,
      status: 'pending' as const,
      payload: recentlyViewed,
    }

    const queuedCoverage = { workClass: 'primary-monitoring' as const, status: 'pending' as const, payload: coverage }

    expect(fitForVisitor(queuedRecentlyViewed, ['ranked'])).toEqual({ action: 'attach' })
    expect(fitForVisitor(queuedCoverage, ['ranked'])).toEqual({ action: 'attach' })
  })

  test('widens an interactive refresh that misses a section and attaches to one that covers', () => {
    const rankedOnly = {
      workClass: 'interactive' as const,
      status: 'pending' as const,
      payload: { brawlhallaId: 7, staleSections: ['ranked'] },
    }

    expect(fitForVisitor(rankedOnly, ['ranked', 'stats'])).toEqual({
      action: 'take-over',
      workClass: 'interactive',
      payload: { brawlhallaId: 7, staleSections: ['ranked', 'stats'] },
    })

    expect(fitForVisitor(rankedOnly, ['ranked'])).toEqual({ action: 'attach' })
  })

  test('never rewrites a reservation still waiting for admission, which belongs to the visitor admitting it', () => {
    const waiting = {
      workClass: 'interactive' as const,
      status: 'awaiting_admission' as const,
      payload: { brawlhallaId: 7, staleSections: ['stats'] },
    }

    expect(fitForVisitor(waiting, ['ranked'])).toEqual({ action: 'ask-again' })
    expect(fitForVisitor(waiting, ['stats'])).toEqual({ action: 'attach' })
  })

  test('attaches to a running refresh that covers and asks again about one that does not', () => {
    const running = { workClass: 'primary-monitoring' as const, status: 'leased' as const, payload: coverage }

    expect(fitForVisitor(running, ['ranked'])).toEqual({ action: 'attach' })
    expect(fitForVisitor(running, ['ranked', 'stats'])).toEqual({ action: 'ask-again' })
  })

  test('leaves a queued Primary refresh on its schedule, since it already covers both sections', () => {
    const active = { workClass: 'primary-monitoring' as const, status: 'pending' as const, payload: primary }

    expect(fitForVisitor(active, ['ranked', 'stats'])).toEqual({ action: 'attach' })
  })
})

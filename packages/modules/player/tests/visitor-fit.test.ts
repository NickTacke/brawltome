import { describe, expect, test } from 'bun:test'
import { fitForVisitor } from '../jobs/visitor-refresh-takeover'

const coverage = { cohort: 'ranked-coverage', brawlhallaId: 7, staleSections: ['ranked'] }
const recentlyViewed = { cohort: 'recently-viewed', brawlhallaId: 7, staleSections: ['ranked', 'stats'] }
const primary = { assignmentId: 'assignment', brawlhallaId: 7, staleSections: ['ranked', 'stats'] }

describe('visitor fit', () => {
  test('takes over a queued coverage refresh as interactive work with the sections joined', () => {
    expect(fitForVisitor({ workClass: 'primary-monitoring', status: 'pending', payload: coverage }, ['stats'])).toEqual(
      {
        action: 'take-over',
        workClass: 'interactive',
        payload: { cohort: 'ranked-coverage', brawlhallaId: 7, staleSections: ['ranked', 'stats'] },
      },
    )
  })

  test('takes over a queued recently viewed refresh even when it covers, so the visitor waits on interactive priority', () => {
    const active = { workClass: 'primary-monitoring' as const, status: 'pending' as const, payload: recentlyViewed }

    expect(fitForVisitor(active, ['ranked'])).toEqual({
      action: 'take-over',
      workClass: 'interactive',
      payload: { cohort: 'recently-viewed', brawlhallaId: 7, staleSections: ['ranked', 'stats'] },
    })
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

  test('widens a reservation still waiting for admission like a queued refresh', () => {
    const waiting = {
      workClass: 'interactive' as const,
      status: 'awaiting_admission' as const,
      payload: { brawlhallaId: 7, staleSections: ['stats'] },
    }

    expect(fitForVisitor(waiting, ['ranked'])).toMatchObject({
      action: 'take-over',
      payload: { staleSections: ['ranked', 'stats'] },
    })
  })

  test('attaches to a running refresh that covers and waits for one that does not', () => {
    const running = { workClass: 'primary-monitoring' as const, status: 'leased' as const, payload: coverage }

    expect(fitForVisitor(running, ['ranked'])).toEqual({ action: 'attach' })
    expect(fitForVisitor(running, ['ranked', 'stats'])).toEqual({ action: 'wait-for-running' })
  })

  test('leaves a queued Primary refresh on its schedule, since it already covers both sections', () => {
    const active = { workClass: 'primary-monitoring' as const, status: 'pending' as const, payload: primary }

    expect(fitForVisitor(active, ['ranked', 'stats'])).toEqual({ action: 'attach' })
  })
})

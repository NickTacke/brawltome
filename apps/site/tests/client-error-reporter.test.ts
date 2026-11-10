import { describe, expect, test } from 'bun:test'
import type { SiteEventInputContract } from '@brawltome/contracts'
import { notFound } from '@tanstack/react-router'
import { createClientErrorReporter } from '../src/components/errors/client-error-reporter'

const visitId = 'c'.repeat(32)
const tab = { visitId, path: '/player/7', name: 'error.client' } as const

type FakeOptions = {
  countSiteEvent?: (event: SiteEventInputContract) => Promise<unknown>
  tabVisitId?: () => string | null
}

function reporterWith({ countSiteEvent = async () => undefined, tabVisitId = () => visitId }: FakeOptions = {}) {
  return createClientErrorReporter({ tabVisitId, currentPath: () => tab.path, countSiteEvent })
}

function recordingReporter(tabVisitId?: () => string | null) {
  const sent: SiteEventInputContract[] = []
  const reporter = reporterWith({ countSiteEvent: async (event) => sent.push(event), tabVisitId })

  return { reporter, sent }
}

describe('client error reporter', () => {
  test('an error a boundary caught is a render error, with the message of what was thrown', () => {
    const { reporter, sent } = recordingReporter()

    reporter.render(new Error('legend is undefined'))
    reporter.render('thrown as text')

    expect(sent).toEqual([
      { ...tab, kind: 'render', message: 'legend is undefined' },
      { ...tab, kind: 'render', message: 'thrown as text' },
    ])
  })

  test('a page that is not there is no render error', () => {
    const { reporter, sent } = recordingReporter()

    reporter.render(notFound())

    expect(sent).toEqual([])
  })

  test('a script error nothing caught is unhandled, a promise nobody handled a rejection', () => {
    const { reporter, sent } = recordingReporter()

    reporter.unhandled({ message: 'x is not a function' })
    reporter.rejection({ reason: new TypeError('Failed to fetch') })
    reporter.rejection({ reason: undefined })

    expect(sent).toEqual([
      { ...tab, kind: 'unhandled', message: 'x is not a function' },
      { ...tab, kind: 'rejection', message: 'TypeError: Failed to fetch' },
      { ...tab, kind: 'rejection', message: 'undefined' },
    ])
  })

  test('a message is cut to the 1000 characters the api accepts', () => {
    const { reporter, sent } = recordingReporter()

    reporter.unhandled({ message: 'm'.repeat(5_000) })

    expect(sent).toEqual([{ ...tab, kind: 'unhandled', message: 'm'.repeat(1_000) }])
  })

  test('a tab stops reporting after 10 errors, whatever their kind', () => {
    const { reporter, sent } = recordingReporter()

    for (let index = 0; index < 6; index++) {
      reporter.unhandled({ message: `error ${index}` })
      reporter.rejection({ reason: `rejection ${index}` })
      reporter.render(new Error(`render ${index}`))
    }

    expect(sent).toHaveLength(10)
  })

  test('sends nothing for a visitor we may not count', () => {
    const { reporter, sent } = recordingReporter(() => null)

    reporter.render(new Error('legend is undefined'))
    reporter.unhandled({ message: 'x is not a function' })
    reporter.rejection({ reason: 'no' })

    expect(sent).toEqual([])
  })

  test('a failed report never reaches the page, where it would be an error to report in turn', async () => {
    const rejects = reporterWith({ countSiteEvent: () => Promise.reject(new Error('network down')) })

    const throws = reporterWith({
      countSiteEvent: () => {
        throw new Error('server function missing')
      },
    })

    const noVisitId = reporterWith({
      tabVisitId: () => {
        throw new Error('crypto is not available')
      },
    })

    for (const reporter of [rejects, throws, noVisitId]) {
      expect(() => reporter.render(new Error('legend is undefined'))).not.toThrow()
      expect(() => reporter.unhandled({ message: 'x is not a function' })).not.toThrow()
      expect(() => reporter.rejection({ reason: 'no' })).not.toThrow()
    }

    // a rejection left unhandled would surface after the calls return
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test('something thrown that cannot be put into words is dropped without an error', () => {
    const { reporter, sent } = recordingReporter()
    const unreadable = Object.create(null)

    expect(() => reporter.rejection({ reason: unreadable })).not.toThrow()
    expect(() => reporter.render(unreadable)).not.toThrow()
    expect(sent).toEqual([])
  })

  // a reporter that keeps failing must run out like any other, or errors about errors would never end
  test('failed reports count towards the 10 of the tab', () => {
    let attempts = 0

    const reporter = reporterWith({
      countSiteEvent: () => {
        attempts += 1

        throw new Error('server function missing')
      },
    })

    for (let index = 0; index < 25; index++) reporter.unhandled({ message: 'x is not a function' })

    expect(attempts).toBe(10)
  })
})

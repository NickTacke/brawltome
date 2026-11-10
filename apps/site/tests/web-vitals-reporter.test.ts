import { describe, expect, test } from 'bun:test'
import type { SiteEventInputContract } from '@brawltome/contracts'
import { createWebVitalsReporter } from '../src/components/vitals/web-vitals-reporter'

const visitId = 'e'.repeat(32)
const landed = { visitId, path: '/', name: 'vitals', viewportWidth: 390 } as const

function reporterRecording(countSiteEvent: (event: SiteEventInputContract) => Promise<unknown>, currentPath = '/') {
  return createWebVitalsReporter({
    visitId,
    landingPath: '/',
    currentPath: () => currentPath,
    viewportWidth: () => 390.4,
    countSiteEvent,
  })
}

function recordingReporter(currentPath = '/') {
  const sent: SiteEventInputContract[] = []
  const report = reporterRecording(async (event) => sent.push(event), currentPath)

  return { report, sent }
}

describe('web vitals reporter', () => {
  test('a web vital says its name, its value and how wide the viewport is', () => {
    const { report, sent } = recordingReporter()

    report({ name: 'LCP', value: 1834.5, navigationType: 'navigate' })
    report({ name: 'CLS', value: 0.08, navigationType: 'navigate' })

    expect(sent).toEqual([
      { ...landed, metric: 'LCP', value: 1834.5 },
      { ...landed, metric: 'CLS', value: 0.08 },
    ])
  })

  // a click on a link ends LCP, and the address has already changed by the time it is reported
  test('LCP and TTFB belong to the page the tab loaded on, also after the visitor moved on', () => {
    const { report, sent } = recordingReporter('/player/7')

    report({ name: 'LCP', value: 1834.5, navigationType: 'navigate' })
    report({ name: 'TTFB', value: 240, navigationType: 'reload' })

    expect(sent.map((event) => event.path)).toEqual(['/', '/'])
  })

  test('CLS and INP belong to the page on screen when they are reported', () => {
    const { report, sent } = recordingReporter('/player/7')

    report({ name: 'CLS', value: 0.08, navigationType: 'navigate' })
    report({ name: 'INP', value: 96, navigationType: 'navigate' })

    expect(sent.map((event) => event.path)).toEqual(['/player/7', '/player/7'])
  })

  test('a tab brought back from the back/forward cache reports for the page it comes back on', () => {
    const { report, sent } = recordingReporter('/player/7')

    report({ name: 'LCP', value: 12, navigationType: 'back-forward-cache' })
    report({ name: 'TTFB', value: 0, navigationType: 'back-forward-cache' })

    expect(sent.map((event) => event.path)).toEqual(['/player/7', '/player/7'])
  })

  test('values stay inside what the api accepts, and one that is no number is not sent', () => {
    const { report, sent } = recordingReporter()

    report({ name: 'LCP', value: 900_000, navigationType: 'navigate' })
    report({ name: 'CLS', value: -0.5, navigationType: 'navigate' })
    report({ name: 'INP', value: Number.NaN, navigationType: 'navigate' })

    expect(sent).toEqual([
      { ...landed, metric: 'LCP', value: 600_000 },
      { ...landed, metric: 'CLS', value: 0 },
    ])
  })

  test('a tab stops reporting after 20 web vitals', () => {
    const { report, sent } = recordingReporter()

    for (let index = 0; index < 25; index++) report({ name: 'CLS', value: index / 100, navigationType: 'navigate' })

    expect(sent).toHaveLength(20)
  })

  test('a failed report never reaches the page', async () => {
    const rejects = reporterRecording(() => Promise.reject(new Error('network down')))

    const throws = reporterRecording(() => {
      throw new Error('server function missing')
    })

    expect(() => rejects({ name: 'LCP', value: 1834.5, navigationType: 'navigate' })).not.toThrow()
    expect(() => throws({ name: 'LCP', value: 1834.5, navigationType: 'navigate' })).not.toThrow()

    // a rejection left unhandled would surface after the calls return
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

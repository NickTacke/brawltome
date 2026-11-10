import { describe, expect, test } from 'bun:test'
import { watchWebVitals } from '../src/components/vitals/watch-web-vitals'
import type { ReportedWebVital } from '../src/components/vitals/web-vitals-reporter'

type Report = (vital: ReportedWebVital) => void

// stands in for the library: remembers who asked for which metric
function fakeLibrary() {
  const watched = new Map<string, Report>()

  const watch = (name: string) => (report: Report) => {
    watched.set(name, report)
  }

  const library = { onCLS: watch('CLS'), onINP: watch('INP'), onLCP: watch('LCP'), onTTFB: watch('TTFB') }

  return { library, watched }
}

describe('watchWebVitals', () => {
  test('hands the four web vitals the dashboards show to the reporter', async () => {
    const { library, watched } = fakeLibrary()
    const reported: ReportedWebVital[] = []
    const report: Report = (vital) => reported.push(vital)

    await watchWebVitals(report, async () => library)

    expect([...watched.keys()].sort()).toEqual(['CLS', 'INP', 'LCP', 'TTFB'])

    const vital = { name: 'LCP', value: 1834.5, navigationType: 'navigate' } as const

    watched.get('LCP')?.(vital)

    expect(reported).toEqual([vital])
  })

  test('never loads the library for a visitor we may not count', async () => {
    let loadCount = 0

    await watchWebVitals(null, async () => {
      loadCount += 1

      return fakeLibrary().library
    })

    expect(loadCount).toBe(0)
  })

  test('a library that fails to load never reaches the page', async () => {
    const loadLibrary = () => Promise.reject(new Error('chunk missing'))

    expect(await watchWebVitals(() => undefined, loadLibrary)).toBeUndefined()
  })
})

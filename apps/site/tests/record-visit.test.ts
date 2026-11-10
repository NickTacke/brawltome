import { describe, expect, spyOn, test } from 'bun:test'
import { recordVisit } from '../src/server/record-visit'
import type { VisitSignals } from '../src/server/visit-signals'
import { stubFetch, useApiSettings } from './api-stub'

const visitorAddress = '198.51.100.20'
const visit = { visitId: 'e'.repeat(32), path: '/player/7', viewportWidth: 1280 }

const signals: VisitSignals = {
  isSameOrigin: true,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/18.0 Safari/605.1.15',
  acceptLanguage: 'en',
  doNotTrack: undefined,
  globalPrivacyControl: undefined,
}

const visitor = {
  headers: { 'x-visitor-real-ip': visitorAddress, 'x-visitor-user-agent': signals.userAgent ?? '' },
  refreshTrust: undefined,
  keepRefreshTrust: () => {},
}

describe('recordVisit', () => {
  useApiSettings()

  test('passes a browser visit to the api, for the visitor it came from', async () => {
    const calls: RequestInit[] = []
    const urls = stubFetch(() => ({ status: 200, body: { recorded: true } }))
    const fetchSpy = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }

    await recordVisit(visit, { signals, visitor })
    calls.push(...fetchSpy.mock.calls.map(([, init]) => init))

    expect(urls).toEqual(['/visits'])
    expect(new Headers(calls[0].headers).get('x-visitor-real-ip')).toBe(visitorAddress)
    expect(JSON.parse(String(calls[0].body))).toEqual(visit)
  })

  test('never asks the api about a request that is not a browser visit', async () => {
    const urls = stubFetch(() => ({ status: 200, body: { recorded: true } }))

    await recordVisit(visit, { signals: { ...signals, acceptLanguage: undefined }, visitor })

    expect(urls).toEqual([])
  })

  test('a failed send never fails the page, and the log never names the visitor', async () => {
    const errors = spyOn(console, 'error').mockImplementation(() => undefined)

    stubFetch(() => ({ status: 500, body: {} }))

    expect(await recordVisit(visit, { signals, visitor })).toBeUndefined()
    expect(errors).toHaveBeenCalled()
    expect(JSON.stringify(errors.mock.calls)).not.toContain(visitorAddress)
  })

  test('an unreachable api never fails the page either', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch

    expect(await recordVisit(visit, { signals, visitor })).toBeUndefined()
  })
})

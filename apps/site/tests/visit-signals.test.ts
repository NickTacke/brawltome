import { describe, expect, test } from 'bun:test'
import { isCountableVisit, type VisitSignals } from '../src/server/visit-signals'

const browser: VisitSignals = {
  isSameOrigin: true,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  acceptLanguage: 'en-GB,en;q=0.9',
  doNotTrack: undefined,
  globalPrivacyControl: undefined,
}

describe('isCountableVisit', () => {
  test('counts a page in a browser', () => {
    expect(isCountableVisit(browser)).toBe(true)
  })

  test('drops a request that did not come from a page on this site', () => {
    expect(isCountableVisit({ ...browser, isSameOrigin: false })).toBe(false)
  })

  test.each(['curl/8.7.1', 'python-requests/2.32', '', undefined])(
    'drops a client that is not a browser: %p',
    (userAgent) => {
      expect(isCountableVisit({ ...browser, userAgent })).toBe(false)
    },
  )

  // browsers always send one, simple scripts and some headless setups don't
  test('drops a request without the languages every browser sends', () => {
    expect(isCountableVisit({ ...browser, acceptLanguage: undefined })).toBe(false)
  })

  test('respects do not track and global privacy control', () => {
    expect(isCountableVisit({ ...browser, doNotTrack: '1' })).toBe(false)
    expect(isCountableVisit({ ...browser, globalPrivacyControl: '1' })).toBe(false)
  })
})

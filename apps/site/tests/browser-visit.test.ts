import { describe, expect, test } from 'bun:test'
import {
  isMeasuringAllowed,
  isReloadNavigation,
  randomVisitId,
  referrerDomainOf,
} from '../src/components/visits/browser-visit'

describe('browser visit', () => {
  test('measures an ordinary browser', () => {
    expect(isMeasuringAllowed({ doNotTrack: null, globalPrivacyControl: undefined, webdriver: false })).toBe(true)
  })

  test.each([
    { doNotTrack: '1', globalPrivacyControl: undefined, webdriver: false },
    { doNotTrack: null, globalPrivacyControl: true, webdriver: false },
    { doNotTrack: null, globalPrivacyControl: undefined, webdriver: true },
  ])('measures nothing when the browser opts out or is automated: %o', (browser) => {
    expect(isMeasuringAllowed(browser)).toBe(false)
  })

  test('names other sites by their domain, and no referrer as direct', () => {
    expect(referrerDomainOf('https://www.reddit.com/r/Brawlhalla/comments/1', 'brawltome.app')).toBe('reddit.com')
    expect(referrerDomainOf('', 'brawltome.app')).toBe('direct')
  })

  test('leaves out links from the site itself and anything unreadable', () => {
    expect(referrerDomainOf('https://brawltome.app/player/7', 'brawltome.app')).toBeUndefined()
    expect(referrerDomainOf('not a url', 'brawltome.app')).toBeUndefined()
  })

  test('tells a reload from a fresh visit', () => {
    expect(isReloadNavigation([{ type: 'reload' }])).toBe(true)
    expect(isReloadNavigation([{ type: 'navigate' }])).toBe(false)
    expect(isReloadNavigation([])).toBe(false)
  })

  test('draws a fresh 32 character visit id', () => {
    const first = randomVisitId()

    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(randomVisitId()).not.toBe(first)
  })
})

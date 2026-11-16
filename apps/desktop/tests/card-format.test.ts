import { describe, expect, test } from 'bun:test'
import {
  cardScale,
  failureText,
  formatCount,
  legendPortraitPath,
  tierBannerPath,
  winRateClass,
  winRatePercent,
} from '../ui/overlay/card-format'

describe('card format', () => {
  test('rounds the win rate and has none without games', () => {
    expect(winRatePercent(734, 1204)).toBe(61)
    expect(winRatePercent(1, 3)).toBe(33)
    expect(winRatePercent(0, 0)).toBeNull()
  })

  test('colours the win rate by the rule the site uses', () => {
    expect(winRateClass(60)).toBe('rate-high')
    expect(winRateClass(59)).toBe('rate-mid')
    expect(winRateClass(50)).toBe('rate-mid')
    expect(winRateClass(49)).toBe('rate-low')
  })

  test('writes counts the same on every machine', () => {
    expect(formatCount(1204)).toBe('1,204')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1234567)).toBe('1,234,567')
  })

  test('finds the banner the way the site does', () => {
    expect(tierBannerPath('Diamond')).toBe('/banners/Diamond.png')
    expect(tierBannerPath('Platinum 5')).toBe('/banners/Platinum%205.png')
    expect(tierBannerPath('Gold')).toBe('/banners/Gold.png')
    expect(tierBannerPath('Valhallan')).toBe('/banners/Valhallan.png')
    expect(tierBannerPath('none')).toBe('/banners/Unranked.png')
    expect(tierBannerPath(null)).toBeNull()
  })

  test('finds a portrait by the lowercased legend name', () => {
    expect(legendPortraitPath('Lord Vraxx')).toBe('/legends/lord vraxx.png')
    expect(legendPortraitPath('Hattori')).toBe('/legends/hattori.png')
    expect(legendPortraitPath(null)).toBeNull()
  })

  test('says why a lookup failed in a few words', () => {
    expect(failureText('offline')).toBe('No connection')
    expect(failureText('rateLimited')).toBe('Too many lookups')
    expect(failureText('unavailable')).toBe('BrawlTome is down')
    expect(failureText('updateRequired')).toBe('Update BrawlTome')
    expect(failureText('rejected')).toBe("Couldn't load")
  })

  test('scales the cards with the monitor height, not the display scaling', () => {
    expect(cardScale(1080, 1)).toBe(1)
    expect(cardScale(1440, 1)).toBeCloseTo(4 / 3)
    expect(cardScale(1080, 1.25)).toBeCloseTo(0.8)
    expect(cardScale(2160, 1.5)).toBeCloseTo(4 / 3)
  })
})

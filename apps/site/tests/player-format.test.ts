import { describe, expect, test } from 'bun:test'
import {
  bestRating,
  eloReset,
  formatCompact,
  formatHours,
  formatShort,
  legendName,
  rankBanner,
  tierColour,
  tierName,
  virtualLevel,
  winPercent,
  winRateColour,
} from '../src/components/player/player-format'
import { regionOption } from '../src/components/regions'

describe('number formats', () => {
  test('hours are rounded and carry a unit', () => {
    expect(formatHours(7200)).toBe('2h')
  })

  test.each([
    [999_500, '1M'],
    [100_000, '100K'],
    [1500, '1.5K'],
    [999, '999'],
  ])('formatShort(%p) is %p', (value, expected) => {
    expect(formatShort(value)).toBe(expected)
  })

  test.each([
    [1_234_567, '1.23M'],
    [10_000, '10.0K'],
  ])('formatCompact(%p) is %p', (value, expected) => {
    expect(formatCompact(value)).toBe(expected)
  })
})

describe('win rate', () => {
  test('no games is zero percent', () => {
    expect(winPercent(1, 0)).toBe(0)
  })

  test.each([
    [60, 'text-emerald-400'],
    [50, 'text-primary'],
    [49.9, 'text-soft'],
  ])('%p percent is %p', (percent, expected) => {
    expect(winRateColour(percent)).toBe(expected)
  })
})

describe('rank banners', () => {
  test.each([
    ['Gold 3', '/images/banners/Gold%203.png'],
    ['Diamond', '/images/banners/Diamond.png'],
    ['Valhallan', '/images/banners/Valhallan.png'],
    ['none', '/images/banners/Unranked.png'],
    [null, '/images/banners/Unranked.png'],
  ])('%p uses %p', (tier, expected) => {
    expect(rankBanner(tier)).toBe(expected)
  })
})

describe('eloReset', () => {
  test('leaves a rating under 1400 alone', () => {
    expect(eloReset(1399)).toBe(1399)
  })

  test('squashes a high rating', () => {
    expect(eloReset(2807)).toBe(1910)
  })
})

describe('tierColour', () => {
  test.each([
    ['Platinum 2', '#38bdf8'],
    ['Valhallan', '#e9a8f5'],
    [null, '#3b4252'],
  ])('%p is %p', (tier, expected) => {
    expect(tierColour(tier)).toBe(expected)
  })
})

describe('tierName', () => {
  test.each([
    ['Gold 3', 'Gold 3'],
    ['Valhallan', 'Valhallan'],
    ['none', 'Unranked'],
    [null, 'Unranked'],
  ])('%p reads as %p', (tier, expected) => {
    expect(tierName(tier)).toBe(expected)
  })
})

describe('bestRating', () => {
  test('uses the current rating when the stored peak is below it', () => {
    expect(bestRating(2807, 2700)).toBe(2807)
  })

  test('uses the peak otherwise', () => {
    expect(bestRating(2700, 2825)).toBe(2825)
  })
})

test('virtualLevel works past the level cap', () => {
  expect(virtualLevel(1_074_400).level).toBe(100)
})

test('legendName spells Red Raptor out', () => {
  expect(legendName('redraptor')).toBe('Red Raptor')
})

describe('regionOption', () => {
  test('finds a region the game reports', () => {
    expect(regionOption('EU')?.label).toBe('Europe')
  })

  test.each([null, 'XX'])('has nothing for %p', (region) => {
    expect(regionOption(region)).toBeUndefined()
  })
})

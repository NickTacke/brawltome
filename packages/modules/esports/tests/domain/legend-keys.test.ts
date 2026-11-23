import { describe, expect, test } from 'bun:test'
import { buildKnownLegendKeys } from '../../domain/legend-keys'

describe('buildKnownLegendKeys', () => {
  const keys = buildKnownLegendKeys()

  test('lowercases display names and keeps the spaces', () => {
    expect(keys.has('king zuva')).toBe(true)
    expect(keys.has('qinghua & baobao')).toBe(true)
    expect(keys.has('mordex')).toBe(true)
  })

  test('uses the same keys as the site art for names with accents and for Red Raptor', () => {
    expect(keys.has('bodvar')).toBe(true)
    expect(keys.has('redraptor')).toBe(true)
    expect(keys.has('red raptor')).toBe(false)
  })

  test('leaves out Random and the empty default legend', () => {
    expect(keys.has('random')).toBe(false)
    expect(keys.has('')).toBe(false)
  })
})

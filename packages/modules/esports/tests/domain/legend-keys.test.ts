import { describe, expect, test } from 'bun:test'
import { buildKnownLegendKeys, buildLegendLookup, resolveLegendKey } from '../../domain/legend-keys'

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

describe('resolveLegendKey', () => {
  const lookup = buildLegendLookup()

  test('reads the names brawltools writes in capitals with underscores', () => {
    expect(resolveLegendKey('LIN_FEI', lookup)).toBe('lin fei')
    expect(resolveLegendKey('QUEEN_NAI', lookup)).toBe('queen nai')
    expect(resolveLegendKey('RED_RAPTOR', lookup)).toBe('redraptor')
    expect(resolveLegendKey('QINGHUA_&_BAOBAO', lookup)).toBe('qinghua & baobao')
    expect(resolveLegendKey('BODVAR', lookup)).toBe('bodvar')
    expect(resolveLegendKey('Mordex', lookup)).toBe('mordex')
  })

  test('knows no legend for a Random pick, an empty name or a name without art', () => {
    expect(resolveLegendKey('RANDOM', lookup)).toBeNull()
    expect(resolveLegendKey('', lookup)).toBeNull()
    expect(resolveLegendKey('NME_PERK', lookup)).toBeNull()
  })
})

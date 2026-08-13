import { describe, expect, test } from 'bun:test'
import { buildLegendMetaQueryString, parseLegendMetaSearchParams } from '../../../src/components/statistics/utils'

describe('Legend Meta URL filters', () => {
  test('defaults missing or unsupported values independently', () => {
    expect(parseLegendMetaSearchParams(new URLSearchParams())).toEqual({ region: 'all', bracket: 'all' })
    expect(parseLegendMetaSearchParams(new URLSearchParams('region=EU&bracket=Gold'))).toEqual({
      region: 'EU',
      bracket: 'all',
    })
    expect(parseLegendMetaSearchParams(new URLSearchParams('region=GLOBAL&bracket=Diamond%2B'))).toEqual({
      region: 'all',
      bracket: 'Diamond+',
    })
  })

  test('round-trips independent region and bracket filters without a season claim', () => {
    const query = buildLegendMetaQueryString({ region: 'JPN', bracket: 'Platinum' })
    expect(query).toBe('region=JPN&bracket=Platinum')
    expect(parseLegendMetaSearchParams(new URLSearchParams(query))).toEqual({ region: 'JPN', bracket: 'Platinum' })
    expect(query).not.toContain('season')
  })
})

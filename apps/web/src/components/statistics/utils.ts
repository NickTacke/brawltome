import { type LegendMetaInput, legendMetaBrackets, legendMetaRegions } from '@brawltome/contracts'

export function parseLegendMetaSearchParams(searchParams: URLSearchParams): LegendMetaInput {
  const region = searchParams.get('region')
  const bracket = searchParams.get('bracket')
  return {
    region: legendMetaRegions.includes(region as LegendMetaInput['region'])
      ? (region as LegendMetaInput['region'])
      : 'all',
    bracket: legendMetaBrackets.includes(bracket as LegendMetaInput['bracket'])
      ? (bracket as LegendMetaInput['bracket'])
      : 'all',
  }
}

export function buildLegendMetaQueryString(filters: LegendMetaInput): string {
  return new URLSearchParams(filters).toString()
}

import {
  type LegendMetaInput,
  type LegendMetaOutput,
  legendMetaBrackets,
  legendMetaRegions,
} from '@brawltome/contracts'

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

type LegendMetaSliceCoverage = Exclude<LegendMetaOutput, { status: 'unavailable' }>['sliceCoverage']

// null means nothing about this view needs saying, so the page shows no label at all
export function sliceCoverageNote(coverage: LegendMetaSliceCoverage): string | null {
  const notes: string[] = []

  if (coverage.leftOutCells.length > 0) {
    const names = coverage.leftOutCells.map(({ region, bracket }) => `${region} ${bracket}`).join(', ')

    notes.push(
      `Covers ${coverage.coveredCells} of the ${coverage.filterCells} cells in this view. Left out for too few players: ${names}.`,
    )
  }

  if (coverage.includesPlatinumBoardTop) {
    notes.push("Platinum here is only the top of each region's leaderboard, not all Platinum players.")
  }

  return notes.length > 0 ? notes.join(' ') : null
}

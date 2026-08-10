import { type LegendMetaOutput, parseLegendMetaOutput } from '@brawltome/contracts'
import type { LegendMetaQueryResult } from '@brawltome/statistics'

export function mapLegendMetaOutput(result: LegendMetaQueryResult): LegendMetaOutput {
  if (result.status === 'unavailable') {
    return parseLegendMetaOutput({
      status: 'unavailable',
      reason: 'not_yet_published',
      filter: { region: result.region, bracket: result.bracket },
    })
  }

  const { slice, region, bracket, staleReason, ...snapshot } = result
  return parseLegendMetaOutput({
    ...snapshot,
    staleReason:
      staleReason === 'latest-build-failed'
        ? 'latest_build_failed'
        : staleReason === 'publication-overdue'
          ? 'publication_overdue'
          : null,
    filter: { region, bracket },
    selectedPlayers: slice.selectedPlayers,
    observedPlayers: slice.observedPlayers,
    observedLegendGames: slice.observedLegendGames,
    coverage: slice.coverage,
    rows: slice.rows.map(({ eligible, ...row }) => ({
      ...row,
      eligibility: eligible
        ? { status: 'eligible' as const }
        : {
            status: 'insufficient-sample' as const,
            minimumPlayers: 30 as const,
            minimumGames: 200 as const,
          },
    })),
  })
}

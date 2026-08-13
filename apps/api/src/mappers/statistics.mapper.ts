import {
  type LegendMetaHistoryOutput,
  type LegendMetaOutput,
  parseLegendMetaHistoryOutput,
  parseLegendMetaOutput,
} from '@brawltome/contracts'
import type { LegendMetaArtifactSlice, LegendMetaHistoryView, LegendMetaQueryResult } from '@brawltome/statistics'

function mapLegendRows(rows: LegendMetaArtifactSlice['rows']) {
  return rows.map(({ eligible, ...row }) => ({
    ...row,
    eligibility: eligible
      ? { status: 'eligible' as const }
      : {
          status: 'insufficient-sample' as const,
          minimumPlayers: 30 as const,
          minimumGames: 200 as const,
        },
  }))
}

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
    rows: mapLegendRows(slice.rows),
  })
}

export function mapLegendMetaHistoryOutput(result: LegendMetaHistoryView): LegendMetaHistoryOutput {
  if (result.status === 'unavailable') {
    return parseLegendMetaHistoryOutput({
      status: 'unavailable',
      reason: 'not_yet_published',
      filter: { region: result.region, bracket: result.bracket },
    })
  }

  return parseLegendMetaHistoryOutput({
    status: 'available',
    filter: { region: result.region, bracket: result.bracket },
    entries: result.entries.map(({ snapshot, comparisonToPrevious }) => {
      const { compatibility, data, sequence: _sequence, rows: _rows, ...identity } = snapshot
      const { region: _region, bracket: _bracket, rows, ...evidence } = data
      return {
        snapshot: {
          ...identity,
          methodologyVersion: compatibility.metricMethodologyVersion,
          cohortMethodologyVersion: compatibility.cohortMethodologyVersion,
          season: {
            scope: 'current-season',
            identity: compatibility.season.applicability === 'required' ? compatibility.season.identity : null,
            source: 'brawlhalla-v1-ranked-1v1',
          },
          scope: compatibility.scope,
          ...evidence,
          rows: mapLegendRows(rows),
        },
        comparisonToPrevious,
      }
    }),
  })
}

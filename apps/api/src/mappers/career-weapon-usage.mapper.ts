import {
  type CareerWeaponUsageHistoryOutputContract,
  type CareerWeaponUsageOutputContract,
  parseCareerWeaponUsageHistoryOutput,
  parseCareerWeaponUsageOutput,
} from '@brawltome/contracts'
import type { CareerWeaponUsageHistoryView, CareerWeaponUsageView } from '@brawltome/statistics'

export function mapCareerWeaponUsageHistoryOutput(
  view: CareerWeaponUsageHistoryView,
): CareerWeaponUsageHistoryOutputContract {
  if (view.status === 'unavailable') {
    return parseCareerWeaponUsageHistoryOutput({ ...view, reason: 'not_yet_published' })
  }

  return parseCareerWeaponUsageHistoryOutput({
    status: 'available',
    filters: view.filters,
    entries: view.entries.map(({ snapshot, comparisonToPrevious }) => {
      const { compatibility, data, sequence: _sequence, rows: _rows, ...identity } = snapshot
      return {
        snapshot: {
          ...identity,
          methodologyVersion: compatibility.metricMethodologyVersion,
          cohortMethodologyVersion: compatibility.cohortMethodologyVersion,
          scope: compatibility.scope,
          ...data,
        },
        comparisonToPrevious,
      }
    }),
  })
}

export function mapCareerWeaponUsageOutput(view: CareerWeaponUsageView): CareerWeaponUsageOutputContract {
  if (view.status === 'unavailable') {
    return parseCareerWeaponUsageOutput({
      ...view,
      reason: 'not_yet_published',
    })
  }

  const { latestDecision: _latestDecision, staleReasons, ...snapshot } = view
  return parseCareerWeaponUsageOutput({
    ...snapshot,
    staleReasons: staleReasons.map((reason) => reason.replaceAll('-', '_')),
  })
}

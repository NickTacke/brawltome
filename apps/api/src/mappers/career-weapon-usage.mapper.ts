import { type CareerWeaponUsageOutputContract, parseCareerWeaponUsageOutput } from '@brawltome/contracts'
import type { CareerWeaponUsageView } from '@brawltome/statistics'

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

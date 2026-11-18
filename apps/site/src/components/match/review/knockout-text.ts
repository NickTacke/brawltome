import type { Knockout, KoZone } from '@brawltome/contracts'
import { weaponLabel } from '../weapon-label'
import { weaponMoveCode } from './move-notation'

export const zoneNames: Record<KoZone, string> = { side: 'Off the side', top: 'Off the top', bottom: 'Off the bottom' }

function isCredited(knockout: Knockout): boolean {
  return knockout.killer !== null && knockout.killer !== knockout.victim
}

/** What sent a player out, in the community's terms: `greatsword dsig`, or `SD` when nobody did. */
export function knockoutMove(knockout: Knockout): string {
  if (knockout.isByTeammate) return 'team KO'

  if (knockout.move === null || knockout.weapon === null) return isCredited(knockout) ? 'KO' : 'SD'

  return weaponMoveCode(`${weaponLabel(knockout.weapon)} ${knockout.move}`)
}

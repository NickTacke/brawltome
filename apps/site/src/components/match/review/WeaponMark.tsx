import { weaponIconName } from '../weapon-icon'
import { weaponLabel } from '../weapon-label'

/** A weapon as the game draws it, or its name for the ones without a picture, like items and gadgets. */
export function WeaponMark({ weapon }: { weapon: string }) {
  const icon = weaponIconName(weapon)

  if (!icon) return <span className="text-soft">{weaponLabel(weapon).toLowerCase()}</span>

  return <img src={`/images/weapons/${icon}.svg`} alt={weaponLabel(weapon)} className="size-4 object-contain" />
}

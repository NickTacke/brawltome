import { weaponIconName } from '../weapon-icon'

/** A weapon's icon; anything held without one of its own shows as unarmed. */
export function weaponImageUrl(weapon: string): string {
  return `/images/weapons/${weaponIconName(weapon) ?? 'Unarmed'}.svg`
}

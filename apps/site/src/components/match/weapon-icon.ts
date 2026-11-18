// the weapons the site has an icon for in public/images/weapons, by the game's own names; items and gadgets have none
const iconNames: Record<string, string> = {
  Sword: 'Sword',
  Hammer: 'Hammer',
  Pistol: 'Blasters',
  RocketLance: 'Lance',
  Spear: 'Spear',
  Katar: 'Katars',
  Axe: 'Axe',
  Bow: 'Bow',
  Fists: 'Gauntlets',
  Scythe: 'Scythe',
  Cannon: 'Cannon',
  Orb: 'Orb',
  Greatsword: 'Greatsword',
  Boots: 'Boots',
  Chakram: 'Chakrams',
  Unarmed: 'Unarmed',
}

// a thrown weapon hits as ThrowAxe, ThrowLance and so on
const thrownNames: Record<string, string> = { Lance: 'RocketLance' }

/** The file name of a weapon's icon, for the game's name of it or of throwing it; null for anything else held. */
export function weaponIconName(weapon: string): string | null {
  const thrown = weapon.startsWith('Throw') ? weapon.slice('Throw'.length) : null
  const base = thrown === null ? weapon : (thrownNames[thrown] ?? thrown)

  return iconNames[base] ?? null
}

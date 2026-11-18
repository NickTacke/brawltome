// the names players know the weapons by, where the game's own name differs

const weaponLabels: Record<string, string> = {
  Pistol: 'Blasters',
  Fists: 'Gauntlets',
  RocketLance: 'Rocket Lance',
  Katar: 'Katars',
  Chakram: 'Chakrams',
  Unarmed: 'Unarmed',
}

// everything else a player can hold, like a thrown bomb or a mine, is an item
const realWeapons = new Set([
  'Sword',
  'Hammer',
  'Pistol',
  'RocketLance',
  'Spear',
  'Katar',
  'Axe',
  'Bow',
  'Fists',
  'Scythe',
  'Cannon',
  'Orb',
  'Greatsword',
  'Boots',
  'Chakram',
  'Unarmed',
])

/** A weapon as players name it: `Pistol` is `Blasters`, `RocketLance` is `Rocket Lance`. */
export function weaponLabel(weapon: string): string {
  return weaponLabels[weapon] ?? weapon.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function isRealWeapon(weapon: string): boolean {
  return realWeapons.has(weapon)
}

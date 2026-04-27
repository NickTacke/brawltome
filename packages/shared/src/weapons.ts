// Pure, client-safe weapon-name normalization. Kept in its own file (and exposed
// via the './weapons' subpath export) so consumers can import without dragging
// in @brawltome/database / postgres through ./game-data's transitive imports.

const WEAPON_NAME_MAP: Record<string, string> = {
  Fists: 'Gauntlets',
  Pistol: 'Blasters',
  Katar: 'Katars',
  RocketLance: 'Lance',
  Chakram: 'Chakrams',
}

export function normalizeWeaponName(name: string): string {
  return WEAPON_NAME_MAP[name] ?? name
}

export type LegendReference = {
  legendId: number
  legendNameKey: string
  bioName: string
  weaponOne: string
  weaponTwo: string
}

export type LegendReferenceIndex = {
  getById: (id: number) => LegendReference | undefined
  getByKey: (key: string) => LegendReference | undefined
}

export type LegendWeaponStats = {
  legendId: number
  damageWeaponOne: bigint
  damageWeaponTwo: bigint
  timeHeldWeaponOne: number
  timeHeldWeaponTwo: number
  koWeaponOne: number
  koWeaponTwo: number
}

export type WeaponAggregate = {
  weapon: string
  timeHeld: number
  damage: bigint
  kos: number
}

const LEGEND_SLUG_OVERRIDES: Record<number, string> = { 17: 'redraptor' }

const WEAPON_NAME_MAP: Record<string, string> = {
  Fists: 'Gauntlets',
  Pistol: 'Blasters',
  Katar: 'Katars',
  RocketLance: 'Lance',
  Chakram: 'Chakrams',
}

export function createLegendReferenceIndex(records: LegendReference[]): LegendReferenceIndex {
  const byId = new Map(records.map((record) => [record.legendId, record]))
  const byKey = new Map(records.map((record) => [record.legendNameKey, record]))

  return {
    getById: (id) => byId.get(id),
    getByKey: (key) => byKey.get(key),
  }
}

export function legendSlug(legendId: number, legendName: string): string {
  return (
    LEGEND_SLUG_OVERRIDES[legendId] ??
    legendName
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
  )
}

export function normalizeWeaponName(name: string): string {
  return WEAPON_NAME_MAP[name] ?? name
}

export function aggregateWeapons(legends: LegendWeaponStats[], references: LegendReferenceIndex): WeaponAggregate[] {
  const aggregates = new Map<string, Omit<WeaponAggregate, 'weapon'>>()

  for (const legend of legends) {
    const reference = references.getById(legend.legendId)
    if (!reference) continue

    addWeaponStats(aggregates, normalizeWeaponName(reference.weaponOne), {
      timeHeld: legend.timeHeldWeaponOne,
      damage: legend.damageWeaponOne,
      kos: legend.koWeaponOne,
    })
    addWeaponStats(aggregates, normalizeWeaponName(reference.weaponTwo), {
      timeHeld: legend.timeHeldWeaponTwo,
      damage: legend.damageWeaponTwo,
      kos: legend.koWeaponTwo,
    })
  }

  return Array.from(aggregates, ([weapon, stats]) => ({ weapon, ...stats })).sort(
    (left, right) => right.timeHeld - left.timeHeld,
  )
}

function addWeaponStats(
  aggregates: Map<string, Omit<WeaponAggregate, 'weapon'>>,
  weapon: string,
  stats: Omit<WeaponAggregate, 'weapon'>,
): void {
  const current = aggregates.get(weapon) ?? { timeHeld: 0, damage: 0n, kos: 0 }
  current.timeHeld += stats.timeHeld
  current.damage += stats.damage
  current.kos += stats.kos
  aggregates.set(weapon, current)
}

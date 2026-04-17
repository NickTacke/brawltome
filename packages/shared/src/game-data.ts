import type { BhApiClient } from '@brawltome/bhapi'
import { legend } from '@brawltome/database'
import type { Database } from '@brawltome/database'

const WEAPON_NAME_MAP: Record<string, string> = {
  Fists: 'Gauntlets',
  Pistol: 'Blasters',
  Katar: 'Katars',
  RocketLance: 'Lance',
  Chakram: 'Chakrams',
}

export interface LegendData {
  legendId: number
  legendNameKey: string
  bioName: string
  weaponOne: string
  weaponTwo: string
}

let legendCache: Map<number, LegendData> = new Map()
let legendByKey: Map<string, LegendData> = new Map()

export async function initGameData(db: Database, bhapi?: BhApiClient) {
  const dbLegends = await db.query.legend.findMany()

  if (dbLegends.length === 0) {
    if (!bhapi) {
      console.warn('[game-data] no legends in DB and no bhapi client -- skipping init')
      return
    }
    const apiLegends = await bhapi.getAllLegends({ caller: 'background' })
    for (const l of apiLegends) {
      await db
        .insert(legend)
        .values({
          legendId: l.legend_id,
          legendNameKey: l.legend_name_key,
          bioName: l.bio_name,
          bioAka: l.bio_aka,
          bioQuoteAboutAttrib: '',
          weaponOne: l.weapon_one,
          weaponTwo: l.weapon_two,
          strength: l.strength,
          dexterity: l.dexterity,
          defense: l.defense,
          speed: l.speed,
        })
        .onConflictDoNothing()
    }
    return initGameData(db, bhapi)
  }

  legendCache = new Map(dbLegends.map((l) => [l.legendId, l]))
  legendByKey = new Map(dbLegends.map((l) => [l.legendNameKey, l]))
  console.log(`[game-data] loaded ${legendCache.size} legends`)
}

export function getLegendById(id: number): LegendData | undefined {
  return legendCache.get(id)
}

export function getLegendByKey(key: string): LegendData | undefined {
  return legendByKey.get(key)
}

export function normalizeWeaponName(name: string): string {
  return WEAPON_NAME_MAP[name] ?? name
}

export function aggregateWeapons(
  legends: Array<{
    legendId: number
    damageWeaponOne: bigint
    damageWeaponTwo: bigint
    timeHeldWeaponOne: number
    timeHeldWeaponTwo: number
    koWeaponOne: number
    koWeaponTwo: number
  }>,
): Array<{ weapon: string; timeHeld: number; damage: bigint; kos: number }> {
  const map = new Map<string, { timeHeld: number; damage: bigint; kos: number }>()

  for (const l of legends) {
    const legendData = getLegendById(l.legendId)
    if (!legendData) continue

    const w1 = normalizeWeaponName(legendData.weaponOne)
    const w2 = normalizeWeaponName(legendData.weaponTwo)

    const e1 = map.get(w1) ?? { timeHeld: 0, damage: 0n, kos: 0 }
    e1.timeHeld += l.timeHeldWeaponOne
    e1.damage += l.damageWeaponOne
    e1.kos += l.koWeaponOne
    map.set(w1, e1)

    const e2 = map.get(w2) ?? { timeHeld: 0, damage: 0n, kos: 0 }
    e2.timeHeld += l.timeHeldWeaponTwo
    e2.damage += l.damageWeaponTwo
    e2.kos += l.koWeaponTwo
    map.set(w2, e2)
  }

  return Array.from(map.entries())
    .map(([weapon, stats]) => ({ weapon, ...stats }))
    .sort((a, b) => b.timeHeld - a.timeHeld)
}

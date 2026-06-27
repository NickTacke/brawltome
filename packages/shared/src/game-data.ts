import type { BhApiClient, BhV1Legend } from '@brawltome/bhapi'
import { legend } from '@brawltome/database'
import type { Database } from '@brawltome/database'
import { normalizeWeaponName } from './weapons'

export { normalizeWeaponName } from './weapons'

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
    const apiLegends: BhV1Legend[] = await bhapi.getAllLegendsV1({ caller: 'background' })
    if (apiLegends.length === 0) {
      throw new Error('[game-data] legends API returned no legends; cannot initialize')
    }
    for (const l of apiLegends) {
      await db
        .insert(legend)
        .values({
          legendId: l.legend_id,
          // v1 renamed legend_name_key -> legend_name
          legendNameKey: l.legend_name,
          bioName: l.bio_name,
          bioAka: l.bio_aka,
          // v1 provides the field; v0 hardcoded ''
          bioQuoteAboutAttrib: l.bio_quote_about_attrib,
          weaponOne: l.weapon_one,
          weaponTwo: l.weapon_two,
          // strength/dexterity/defense/speed are varchar columns; v1 sends numbers
          strength: String(l.strength),
          dexterity: String(l.dexterity),
          defense: String(l.defense),
          speed: String(l.speed),
        })
        .onConflictDoNothing()
    }
    const inserted = await db.query.legend.findMany()
    if (inserted.length === 0) {
      throw new Error('[game-data] legend insert produced no rows; cannot initialize')
    }
    legendCache = new Map(inserted.map((l) => [l.legendId, l]))
    legendByKey = new Map(inserted.map((l) => [l.legendNameKey, l]))
    console.log(`[game-data] loaded ${legendCache.size} legends`)
    return
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

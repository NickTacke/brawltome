import type { BhApiClient } from '@brawltome/bhapi'
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

// v1's `legend_name` is an uppercase display string (e.g. "BÖDVAR", "LORD VRAXX"), but the app
// and the avatar/icon assets key off the lowercase v0 `legend_name_key` slug. Stripping diacritics
// and lowercasing reproduces that slug for every legend except Red Raptor, whose asset omits the space.
const LEGEND_SLUG_OVERRIDES: Record<number, string> = { 17: 'redraptor' }

export function legendSlug(legendId: number, legendName: string): string {
  return (
    LEGEND_SLUG_OVERRIDES[legendId] ??
    legendName
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
  )
}

export async function initGameData(db: Database, bhapi?: BhApiClient) {
  if (bhapi) {
    try {
      const apiLegends = await bhapi.getAllLegendsV1({ caller: 'background' })
      for (const l of apiLegends) {
        const values = {
          legendId: l.legend_id,
          legendNameKey: legendSlug(l.legend_id, l.legend_name),
          bioName: l.bio_name,
          bioAka: l.bio_aka,
          bioQuoteAboutAttrib: l.bio_quote_about_attrib,
          weaponOne: l.weapon_one,
          weaponTwo: l.weapon_two,
          strength: String(l.strength),
          dexterity: String(l.dexterity),
          defense: String(l.defense),
          speed: String(l.speed),
        }
        const { legendId: _omit, ...updateSet } = values
        await db.insert(legend).values(values).onConflictDoUpdate({ target: legend.legendId, set: updateSet })
      }
    } catch (err) {
      // Best-effort refresh: if the legends API is unavailable or returns a partial
      // page (getAllLegendsV1 throws), keep startup alive on the existing DB legends.
      console.warn('[game-data] legend refresh failed; using existing DB legends:', err)
    }
  }

  const dbLegends = await db.query.legend.findMany()
  if (dbLegends.length === 0) {
    console.warn('[game-data] no legends available (API + DB empty); cache not initialized')
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

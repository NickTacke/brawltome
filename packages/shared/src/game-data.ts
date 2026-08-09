import type { BhApiClient } from '@brawltome/bhapi'
import { legend } from '@brawltome/database'
import type { Database } from '@brawltome/database'
import {
  type LegendReference,
  type LegendReferenceIndex,
  type LegendWeaponStats,
  type WeaponAggregate,
  aggregateWeapons as aggregateReferenceWeapons,
  createLegendReferenceIndex,
  legendSlug,
  normalizeWeaponName,
} from '@brawltome/game-data/reference-data'

export { legendSlug, normalizeWeaponName } from '@brawltome/game-data/reference-data'
export type LegendData = LegendReference

let legendIndex: LegendReferenceIndex = createLegendReferenceIndex([])

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
  // Normalize the slug on load so avatars are correct even when the API refresh above failed
  // (e.g. rate-limited during a multi-app restart) and we fell back to legend rows written by an
  // older version that stored the raw uppercase v1 legend_name. legendSlug is idempotent.
  const normalized = dbLegends.map((l) => ({ ...l, legendNameKey: legendSlug(l.legendId, l.legendNameKey) }))
  legendIndex = createLegendReferenceIndex(normalized)
  console.log(`[game-data] loaded ${normalized.length} legends`)
}

export function getLegendById(id: number): LegendData | undefined {
  return legendIndex.getById(id)
}

export function getLegendByKey(key: string): LegendData | undefined {
  return legendIndex.getByKey(key)
}

export function aggregateWeapons(legends: LegendWeaponStats[]): WeaponAggregate[] {
  return aggregateReferenceWeapons(legends, legendIndex)
}

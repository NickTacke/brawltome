import type { BhApiClient } from '@brawltome/bhapi'
import { legend } from '@brawltome/database'
import type { Database } from '@brawltome/database'
import { legends as generatedLegends } from '@brawltome/game-data/legends'
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
  const seededLegends = generatedLegends
    .filter(
      (record) => record.heroId > 2 && record.isActive && record.displayName && record.weaponOne && record.weaponTwo,
    )
    .map((record) => ({
      legendId: record.heroId,
      legendNameKey: legendSlug(record.heroId, record.displayName),
      bioName: record.displayName.toLocaleLowerCase().replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase()),
      bioAka: '',
      bioQuoteAboutAttrib: '',
      weaponOne: record.weaponOne,
      weaponTwo: record.weaponTwo,
      strength: String(record.strength),
      dexterity: String(record.dexterity),
      defense: String(record.weight),
      speed: String(record.speed),
    }))
  await db.insert(legend).values(seededLegends).onConflictDoNothing()

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

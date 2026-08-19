export type {
  CatalogDiagnostic,
  Hurtbox,
  Legend,
  LevelMeta,
  PlayerAppearance,
  Power,
  Skin,
  WeaponName,
} from './src/types'

export const CURRENT_ONE_VS_ONE_PLATINUM_MIN_RATING = 1680
export const CURRENT_ONE_VS_ONE_DIAMOND_MIN_RATING = 2000
export type CurrentOneVsOneBracket = 'Platinum' | 'Diamond+'

export function currentOneVsOneBracket(rating: number): CurrentOneVsOneBracket | null {
  if (!Number.isSafeInteger(rating) || rating < CURRENT_ONE_VS_ONE_PLATINUM_MIN_RATING) return null
  return rating < CURRENT_ONE_VS_ONE_DIAMOND_MIN_RATING ? 'Platinum' : 'Diamond+'
}
export {
  aggregateWeapons,
  createLegendReferenceIndex,
  legendAvatarUrl,
  legendSlug,
  normalizeWeaponName,
  type LegendReference,
  type LegendReferenceIndex,
  type LegendWeaponStats,
  type WeaponAggregate,
} from './src/reference-data'

import { hurtboxes } from './src/generated/hurtboxes'
import { legends } from './src/generated/legends'
import { levels } from './src/generated/levels'
import { powers } from './src/generated/powers'
import { skins } from './src/generated/skins'
import { legendAvatarUrl, legendSlug } from './src/reference-data'
import type { Hurtbox, Legend, LevelMeta, PlayerAppearance, Power, Skin } from './src/types'

export { legends, levels, powers, hurtboxes, skins }

const legendById = new Map(legends.map((l) => [l.heroId, l]))
const legendByName = new Map(legends.map((l) => [l.heroName, l]))
const levelById = new Map(levels.map((l) => [l.levelId, l]))
const powerById = new Map(powers.map((p) => [p.powerId, p]))
const hurtboxByName = new Map(hurtboxes.map((h) => [h.hurtboxName, h]))
const skinById = new Map(skins.map((skin) => [skin.skinId, skin]))

export const getLegendById = (id: number): Legend | undefined => legendById.get(id)
export const getLegendByName = (name: string): Legend | undefined => legendByName.get(name)
export const getLevelById = (id: number): LevelMeta | undefined => levelById.get(id)
export const getPowerById = (id: number): Power | undefined => powerById.get(id)
export const getHurtboxByName = (name: string): Hurtbox | undefined => hurtboxByName.get(name)
export const getSkinById = (id: number): Skin | undefined => skinById.get(id)
export const getCrossoverSkinById = (id: number): Skin | undefined => {
  const skin = skinById.get(id)
  return skin?.isCrossover ? skin : undefined
}

export const crossoverSkinIdsByLegend: ReadonlyMap<number, readonly number[]> = (() => {
  const grouped = new Map<number, number[]>()
  for (const skin of skins) {
    if (!skin.isCrossover) continue
    const ids = grouped.get(skin.legendId) ?? []
    ids.push(skin.skinId)
    grouped.set(skin.legendId, ids)
  }
  return grouped
})()

export function resolvePlayerAppearance(legendId: number, skinId: number): PlayerAppearance {
  const legend = getLegendById(legendId)
  if (!legend) {
    return {
      kind: 'legend',
      legendId,
      skinId,
      name: `Legend ${legendId}`,
      imageUrl: null,
      fallbackImageUrl: null,
      diagnostic: { code: 'unknown_legend', legendId, skinId },
    }
  }

  const baseImageUrl = legendAvatarUrl(legendSlug(legend.heroId, legend.displayName))
  const skin = getSkinById(skinId)
  if (!skin) {
    return {
      kind: 'legend',
      legendId,
      skinId,
      name: legend.displayName,
      imageUrl: baseImageUrl,
      fallbackImageUrl: baseImageUrl,
      diagnostic: { code: 'unknown_skin', legendId, skinId },
    }
  }
  if (skin.legendId !== legendId) {
    return {
      kind: 'legend',
      legendId,
      skinId,
      name: legend.displayName,
      imageUrl: baseImageUrl,
      fallbackImageUrl: baseImageUrl,
      diagnostic: { code: 'skin_legend_mismatch', legendId, skinId },
    }
  }
  if (skin.isCrossover && skin.displayName && skin.imageUrl) {
    return {
      kind: 'crossover',
      legendId,
      skinId,
      name: skin.displayName,
      imageUrl: skin.imageUrl,
      fallbackImageUrl: baseImageUrl,
      diagnostic: null,
    }
  }
  return {
    kind: 'legend',
    legendId,
    skinId,
    name: legend.displayName,
    imageUrl: baseImageUrl,
    fallbackImageUrl: baseImageUrl,
    diagnostic: null,
  }
}

export const knownHeroIds: ReadonlySet<number> = new Set(legends.map((l) => l.heroId))
export const knownLevelIds: ReadonlySet<number> = new Set(levels.map((l) => l.levelId))

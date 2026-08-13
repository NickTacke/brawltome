export type { Hurtbox, Legend, LevelMeta, Power, WeaponName } from './src/types'

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
import type { Hurtbox, Legend, LevelMeta, Power } from './src/types'

export { legends, levels, powers, hurtboxes }

const legendById = new Map(legends.map((l) => [l.heroId, l]))
const legendByName = new Map(legends.map((l) => [l.heroName, l]))
const levelById = new Map(levels.map((l) => [l.levelId, l]))
const powerById = new Map(powers.map((p) => [p.powerId, p]))
const hurtboxByName = new Map(hurtboxes.map((h) => [h.hurtboxName, h]))

export const getLegendById = (id: number): Legend | undefined => legendById.get(id)
export const getLegendByName = (name: string): Legend | undefined => legendByName.get(name)
export const getLevelById = (id: number): LevelMeta | undefined => levelById.get(id)
export const getPowerById = (id: number): Power | undefined => powerById.get(id)
export const getHurtboxByName = (name: string): Hurtbox | undefined => hurtboxByName.get(name)

export const knownHeroIds: ReadonlySet<number> = new Set(legends.map((l) => l.heroId))
export const knownLevelIds: ReadonlySet<number> = new Set(levels.map((l) => l.levelId))

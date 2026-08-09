export type { Hurtbox, Legend, LevelMeta, Power, WeaponName } from './src/types'
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

export type { CollisionLine, Hurtbox, Legend, LevelGeometry, LevelMeta, Power, WeaponName } from './src/types'

import { hurtboxes } from './src/generated/hurtboxes'
import { legends } from './src/generated/legends'
import { levelGeometry } from './src/generated/level-geometry'
import { levels } from './src/generated/levels'
import { GAME_DATA_GENERATED_AT, GAME_DATA_PATCH_VERSION } from './src/generated/meta'
import { powers } from './src/generated/powers'
import type { Hurtbox, Legend, LevelGeometry, LevelMeta, Power } from './src/types'

export { legends, levels, powers, hurtboxes, levelGeometry, GAME_DATA_PATCH_VERSION, GAME_DATA_GENERATED_AT }

const legendById = new Map(legends.map((l) => [l.heroId, l]))
const legendByName = new Map(legends.map((l) => [l.heroName, l]))
const levelById = new Map(levels.map((l) => [l.levelId, l]))
const powerById = new Map(powers.map((p) => [p.powerId, p]))
const powerByName = new Map(powers.map((p) => [p.powerName, p]))
const hurtboxByName = new Map(hurtboxes.map((h) => [h.hurtboxName, h]))

export const getLegendById = (id: number): Legend | undefined => legendById.get(id)
export const getLegendByName = (name: string): Legend | undefined => legendByName.get(name)
export const getLevelById = (id: number): LevelMeta | undefined => levelById.get(id)
export const getPowerById = (id: number): Power | undefined => powerById.get(id)
export const getPowerByName = (name: string): Power | undefined => powerByName.get(name)
export const getHurtboxByName = (name: string): Hurtbox | undefined => hurtboxByName.get(name)
export const getLevelGeometry = (levelName: string): LevelGeometry | undefined => levelGeometry[levelName]

export const knownHeroIds: ReadonlySet<number> = new Set(legends.map((l) => l.heroId))
export const knownLevelIds: ReadonlySet<number> = new Set(levels.map((l) => l.levelId))

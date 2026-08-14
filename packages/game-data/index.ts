export type { Hurtbox, Legend, LegendPhysics, LevelMeta, Power, Rune, StatLadder, WeaponName } from './src/types'

import { hurtboxes } from './src/generated/hurtboxes'
import { legends } from './src/generated/legends'
import { levels } from './src/generated/levels'
import { physics } from './src/generated/physics'
import { powers } from './src/generated/powers'
import { runes } from './src/generated/runes'
import { statLadders } from './src/generated/statLadders'
import type { Hurtbox, Legend, LegendPhysics, LevelMeta, Power, Rune } from './src/types'

export { legends, levels, powers, hurtboxes, statLadders, physics, runes }

const legendById = new Map(legends.map((l) => [l.heroId, l]))
const legendByName = new Map(legends.map((l) => [l.heroName, l]))
const levelById = new Map(levels.map((l) => [l.levelId, l]))
const powerById = new Map(powers.map((p) => [p.powerId, p]))
const hurtboxByName = new Map(hurtboxes.map((h) => [h.hurtboxName, h]))
const physicsByHeroId = new Map(physics.map((p) => [p.heroId, p]))

export const getLegendById = (id: number): Legend | undefined => legendById.get(id)
export const getLegendByName = (name: string): Legend | undefined => legendByName.get(name)
export const getLevelById = (id: number): LevelMeta | undefined => levelById.get(id)
export const getPowerById = (id: number): Power | undefined => powerById.get(id)
export const getHurtboxByName = (name: string): Hurtbox | undefined => hurtboxByName.get(name)
export const getPhysicsByHeroId = (id: number): LegendPhysics | undefined => physicsByHeroId.get(id)

// Resolve the physics numbers for a legend from its stat signature. This is
// the same lookup the game performs at load time (hero XML signature × stat
// ladders). Returns the record for heroes with a resolved signature (heroId>0).
export function resolveLegendPhysics(legend: Legend): LegendPhysics | undefined {
  return physicsByHeroId.get(legend.heroId)
}

// Stance (rune) lookup: every legend has 10 runes (0=Base, 1-4=Speed/Strength/
// Weight/Dexterity, 5-8=Super variants, 9=Challenge), each an absolute S/D/W/Sp
// loadout. The replay's stanceIndex references these directly.
const runesByHeroAndIndex = new Map<string, Rune[]>(
  Array.from(new Set(runes.map((r) => r.heroName)), (h) => [h, runes.filter((r) => r.heroName === h)]),
)
export function getRune(heroName: string, runeIndex: number): Rune | undefined {
  return runesByHeroAndIndex.get(heroName)?.find((r) => r.runeIndex === runeIndex)
}
export function getRunesForHero(heroName: string): Rune[] {
  return runesByHeroAndIndex.get(heroName) ?? []
}

export const knownHeroIds: ReadonlySet<number> = new Set(legends.map((l) => l.heroId))
export const knownLevelIds: ReadonlySet<number> = new Set(levels.map((l) => l.levelId))

import type { Knockout, Stock } from '@brawltome/contracts'
import type { MatchFacts } from './facts'
import { readLives } from './lives'

// one entry per life a player had: how long it lasted, what happened in it and how it ended

const koMatchMs = 200

export function readStocks(facts: MatchFacts, slot: number, knockouts: Knockout[]): Stock[] {
  return readLives(facts.record, slot).map((life, index): Stock => {
    const isInside = (timeMs: number) => timeMs >= life.startMs && timeMs <= life.endMs
    const won = facts.punishes.filter((punish) => punish.attacker === slot && isInside(punish.startMs))
    const lost = facts.punishes.filter((punish) => punish.target === slot && isInside(punish.startMs))
    const knockout = knockouts.find((ko) => ko.victim === slot && Math.abs(ko.timeMs - life.endMs) < koMatchMs)

    return {
      slot,
      index,
      startMs: life.startMs,
      endMs: life.endMs,
      isKo: life.isKo || knockout !== undefined,
      tape: life.damage,
      damageTaken: knockout?.damage ?? life.damage.at(-1)?.[1] ?? 0,
      damageDealt: won.reduce((total, punish) => total + punish.damage, 0),
      openingsWon: won.length,
      openingsLost: lost.length,
      knockout: knockout ?? null,
    }
  })
}

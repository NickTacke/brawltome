import type { Punish } from '@brawltome/contracts'
import { type Blow, readBlows } from './blows'
import { punishIndexOfBlow, readPunishes } from './punishes'
import type { MatchRecord } from './record'
import { readStrikes, type Strike } from './strikes'

// what every derived figure starts from, read once per match

export type MatchFacts = {
  record: MatchRecord
  strikes: Strike[]
  blows: Blow[]
  punishes: Punish[]
  // one entry per KO of the match, in order: the index of the punish that ended in it, or null
  koPunishes: (number | null)[]
}

export function readFacts(record: MatchRecord): MatchFacts {
  const strikes = readStrikes(record)
  const blows = readBlows(strikes)

  return { record, strikes, blows, ...readPunishes(record, blows) }
}

// costStep names the punish, so two moments that led to the same one can be told apart
export type Cost = { costDamage: number; costStep: number | null }

/** The punish a player ate if they were hit within the window; no damage when they got away with it. */
export function costWithin(facts: MatchFacts, slot: number, fromStep: number, toStep: number): Cost {
  const blow = facts.blows.find((entry) => entry.target === slot && entry.step > fromStep && entry.step <= toStep)

  if (!blow) return { costDamage: 0, costStep: null }

  const index = punishIndexOfBlow(facts.punishes, blow)
  const punish = index === null ? undefined : facts.punishes[index]

  return { costDamage: punish?.damage ?? blow.damage, costStep: punish?.startStep ?? blow.step }
}

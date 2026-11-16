import type { Habit, HabitMoment } from '@brawltome/contracts'
import { type Cost, costWithin, type MatchFacts } from '../facts'
import { moveCode } from '../move-notation'
import { stateOf, toMs } from '../record'
import { valueAt } from '../series'
import type { Strike } from '../strikes'
import { weaponLabel } from '../weapon-names'
import { makeHabit, minimumSample } from './habit'

// what a player swings with: the move they open neutral with, how many swings miss, and their signatures

const swingLabels = { hit: 'Hit', missed: 'Missed' }

// a swing opens neutral when the player had neither hit nor been hit for a while and wasn't already swinging
const quietSteps = 90
const sinceOwnSwingSteps = 45
const whiffPunishedSteps = 40
const dominantShare = 0.5
const mostlyMissingShare = 0.7
const fewestSignatures = 5

function swingsOf(facts: MatchFacts, slot: number): Strike[] {
  return facts.strikes.filter((strike) => strike.attacker === slot && !strike.isThrow)
}

function whiffCost(facts: MatchFacts, strike: Strike): Cost {
  if (strike.hits.length > 0) return { costDamage: 0, costStep: null }

  return costWithin(facts, strike.attacker, strike.step, strike.endStep + whiffPunishedSteps)
}

function swingMoment(facts: MatchFacts, strike: Strike, option: string): HabitMoment {
  return { timeMs: toMs(facts.record, strike.step), option, ...whiffCost(facts, strike) }
}

function landedOption(strike: Strike): string {
  return strike.hits.length > 0 ? 'hit' : 'missed'
}

function isNeutralOpener(facts: MatchFacts, strike: Strike, previous: Strike | undefined): boolean {
  const slot = strike.attacker

  const wasQuiet = !facts.blows.some(
    (blow) =>
      (blow.attacker === slot || blow.target === slot) &&
      blow.step < strike.step &&
      strike.step - blow.lastStep <= quietSteps,
  )

  const isFresh = !previous || strike.step - previous.endStep > sinceOwnSwingSteps
  const isStunned = valueAt(stateOf(facts.record, slot).hitstun, strike.step, false)

  return wasQuiet && isFresh && !isStunned
}

// as players write it: `axe nlight`
function moveName(strike: Strike): string {
  return `${weaponLabel(strike.weapon).toLowerCase()} ${moveCode(strike.move)}`
}

export function openerHabit(facts: MatchFacts, slot: number): Habit {
  const swings = swingsOf(facts, slot)
  const openers = swings.filter((strike, index) => isNeutralOpener(facts, strike, swings[index - 1]))
  const counts = new Map<string, number>()

  for (const strike of openers) counts.set(moveName(strike), (counts.get(moveName(strike)) ?? 0) + 1)

  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1])
  const labels = Object.fromEntries(ranked.map(([name]) => [name, name]))
  const moments = openers.map((strike) => swingMoment(facts, strike, moveName(strike)))

  return makeHabit(
    {
      key: 'opener',
      situation: 'First swing',
      labels,
      isFlagged: (_top, share, total) => share >= dominantShare && total >= minimumSample,
    },
    moments,
  )
}

export function swingHabit(facts: MatchFacts, slot: number): Habit {
  const moments = swingsOf(facts, slot).map((strike) => swingMoment(facts, strike, landedOption(strike)))

  return makeHabit(
    {
      key: 'swings',
      situation: 'Swings',
      labels: swingLabels,
      isFlagged: (top, share, total) => top.key === 'missed' && share >= mostlyMissingShare && total >= minimumSample,
    },
    moments,
  )
}

export function signatureHabit(facts: MatchFacts, slot: number): Habit {
  const signatures = swingsOf(facts, slot).filter((strike) => strike.isSignature)
  const moments = signatures.map((strike) => swingMoment(facts, strike, landedOption(strike)))

  return makeHabit(
    {
      key: 'signatures',
      situation: 'Signatures',
      labels: swingLabels,
      isFlagged: (top, share, total) => top.key === 'missed' && share >= dominantShare && total >= fewestSignatures,
    },
    moments,
  )
}

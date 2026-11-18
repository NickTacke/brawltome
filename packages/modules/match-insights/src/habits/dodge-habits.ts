import type { Habit, HabitMoment, HabitOption } from '@brawltome/contracts'
import { dodgesOf, isChaseDodge } from '../events'
import { type Cost, costWithin, type MatchFacts } from '../facts'
import type { DodgeEvent } from '../line'
import { nearestEnemy } from '../positions'
import { stateOf, toMs } from '../record'
import { valueAt } from '../series'
import { directionKey, directionLabels } from './dodge-direction'
import { makeHabit, minimumSample } from './habit'
import { stunExits } from './reaction-habits'

// where a player dodges and when: the direction relative to the nearest enemy, and what was going on

const timingLabels = {
  'after-hit': 'Right after a hit',
  threat: 'Against an attack',
  chase: 'Chasing a hit',
  neutral: 'No attack coming',
}

const afterStunSteps = 12
const threatSteps = 25
const dodgeLengthSteps = 20
const punishedWithinSteps = 30
const dominantShare = 0.5
const mostlyNeutralShare = 0.4

function dodgeCost(facts: MatchFacts, slot: number, dodge: DodgeEvent): Cost {
  return costWithin(facts, slot, dodge.step, dodge.step + dodgeLengthSteps + punishedWithinSteps)
}

function directionMoments(facts: MatchFacts, slot: number, dodges: DodgeEvent[]): HabitMoment[] {
  return dodges.flatMap((dodge): HabitMoment[] => {
    const option = directionKey(facts.record, slot, dodge)

    if (option === null) return []

    return [{ timeMs: toMs(facts.record, dodge.step), option, ...dodgeCost(facts, slot, dodge) }]
  })
}

function isAfterHit(exits: number[], dodge: DodgeEvent): boolean {
  return exits.some((exit) => dodge.step >= exit && dodge.step - exit <= afterStunSteps)
}

function defensiveDodges(facts: MatchFacts, slot: number): DodgeEvent[] {
  return dodgesOf(facts.record, slot).filter((dodge) => !isChaseDodge(dodge))
}

function isOneDirection(_top: HabitOption, share: number, total: number): boolean {
  return share >= dominantShare && total >= minimumSample
}

export function dodgeDirectionHabit(facts: MatchFacts, slot: number): Habit {
  return makeHabit(
    {
      key: 'dodge-direction',
      situation: 'Dodge direction',
      layout: 'pad',
      labels: directionLabels,
      isFlagged: isOneDirection,
    },
    directionMoments(facts, slot, defensiveDodges(facts, slot)),
  )
}

export function dodgeAfterHitHabit(facts: MatchFacts, slot: number): Habit {
  const exits = stunExits(facts, slot)
  const dodges = defensiveDodges(facts, slot).filter((dodge) => isAfterHit(exits, dodge))

  return makeHabit(
    {
      key: 'dodge-after-hit',
      situation: 'Hitstun dodge',
      layout: 'pad',
      labels: directionLabels,
      isFlagged: isOneDirection,
    },
    directionMoments(facts, slot, dodges),
  )
}

function isUnderThreat(facts: MatchFacts, slot: number, step: number): boolean {
  const enemy = nearestEnemy(facts.record, slot, step)

  if (enemy === null) return false

  const isEnemyAttacking = valueAt(stateOf(facts.record, enemy).move, step, '') !== ''

  const justStarted = facts.strikes.some(
    (strike) => strike.attacker === enemy && strike.step <= step + threatSteps && strike.step >= step - threatSteps,
  )

  return isEnemyAttacking || justStarted
}

function timingOf(facts: MatchFacts, slot: number, exits: number[], dodge: DodgeEvent): string {
  if (isChaseDodge(dodge)) return 'chase'

  if (isAfterHit(exits, dodge)) return 'after-hit'

  return isUnderThreat(facts, slot, dodge.step) ? 'threat' : 'neutral'
}

export function dodgeTimingHabit(facts: MatchFacts, slot: number): Habit {
  const exits = stunExits(facts, slot)

  const moments = dodgesOf(facts.record, slot).map(
    (dodge): HabitMoment => ({
      timeMs: toMs(facts.record, dodge.step),
      option: timingOf(facts, slot, exits, dodge),
      ...dodgeCost(facts, slot, dodge),
    }),
  )

  return makeHabit(
    {
      key: 'dodge-timing',
      situation: 'Dodge timing',
      labels: timingLabels,
      isFlagged: (top, share, total) => top.key === 'neutral' && share >= mostlyNeutralShare && total >= minimumSample,
    },
    moments,
  )
}

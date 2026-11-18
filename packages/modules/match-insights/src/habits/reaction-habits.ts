import type { Habit, HabitMoment, HabitOption } from '@brawltome/contracts'
import { playerOf } from '../events'
import { costWithin, type MatchFacts } from '../facts'
import { isLive, stateOf, toMs } from '../record'
import { stepsWhereBecame, valueAt } from '../series'
import { makeHabit, minimumSample } from './habit'

// the first thing a player does when they get control back: out of hitstun, on landing and after a dodge

const reactionLabels = { attack: 'Attack', dodge: 'Dodge', jump: 'Jump', dash: 'Dash', none: 'Wait' }
const reactionTypes = new Set(['attack', 'dodge', 'jump', 'dash'])

// the game treats ten steps after hitstun as "just left hitstun" for its own rules
const afterStunSteps = 10
const afterLandingSteps = 8
const afterDodgeSteps = 10
const stillStunnedSteps = 3
const punishedWithinSteps = 40
const landingCaughtSteps = 14
const dominantShare = 0.6

function firstReaction(facts: MatchFacts, slot: number, fromStep: number, toStep: number): string {
  const event = facts.record.events.find(
    (entry) =>
      playerOf(entry) === slot && entry.step >= fromStep && entry.step <= toStep && reactionTypes.has(entry.type),
  )

  return event?.type ?? 'none'
}

function reactionMoments(facts: MatchFacts, slot: number, steps: number[], windowSteps: number, costSteps: number) {
  return steps.map(
    (step): HabitMoment => ({
      timeMs: toMs(facts.record, step),
      option: firstReaction(facts, slot, step, step + windowSteps),
      ...costWithin(facts, slot, step, step + costSteps),
    }),
  )
}

function isRepeatedAction(top: HabitOption, share: number, total: number): boolean {
  return top.key !== 'none' && share >= dominantShare && total >= minimumSample
}

/** The steps at which a player left hitstun and could act again. */
export function stunExits(facts: MatchFacts, slot: number): number[] {
  const stun = stateOf(facts.record, slot).hitstun

  return stepsWhereBecame(stun, false).filter(
    (step) => isLive(facts.record, slot, step) && !valueAt(stun, step + stillStunnedSteps, false),
  )
}

export function afterHitHabit(facts: MatchFacts, slot: number): Habit {
  const moments = reactionMoments(facts, slot, stunExits(facts, slot), afterStunSteps, punishedWithinSteps)

  return makeHabit(
    { key: 'after-hit', situation: 'After being hit', labels: reactionLabels, isFlagged: isRepeatedAction },
    moments,
  )
}

export function landingHabit(facts: MatchFacts, slot: number): Habit {
  const state = stateOf(facts.record, slot)

  const landings = stepsWhereBecame(state.inAir, false).filter(
    (step) => isLive(facts.record, slot, step) && !valueAt(state.hitstun, step, false),
  )

  return makeHabit(
    { key: 'landing', situation: 'On landing', labels: reactionLabels, isFlagged: isRepeatedAction },
    reactionMoments(facts, slot, landings, afterLandingSteps, landingCaughtSteps),
  )
}

export function afterDodgeHabit(facts: MatchFacts, slot: number): Habit {
  const state = stateOf(facts.record, slot)
  const dodgeEnds = stepsWhereBecame(state.dodging, false).filter((step) => isLive(facts.record, slot, step))

  return makeHabit(
    { key: 'after-dodge', situation: 'After a dodge', labels: reactionLabels, isFlagged: isRepeatedAction },
    reactionMoments(facts, slot, dodgeEnds, afterDodgeSteps, punishedWithinSteps),
  )
}

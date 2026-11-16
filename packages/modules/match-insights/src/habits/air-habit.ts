import type { Habit, HabitOption } from '@brawltome/contracts'
import type { MatchFacts } from '../facts'
import { isLive, stateOf } from '../record'
import { valueAt } from '../series'

// how much of the time a player could act was spent off the ground, and what they ate while up there

const sampleEverySteps = 4
const mostlyAirborneShare = 0.6

type Place = 'air' | 'ground' | 'wall'

const placeLabels: Record<Place, string> = { air: 'In the air', ground: 'On the ground', wall: 'On a wall' }

function placeAt(facts: MatchFacts, slot: number, step: number): Place {
  const state = stateOf(facts.record, slot)

  if (valueAt(state.onWall, step, false)) return 'wall'

  return valueAt(state.inAir, step, false) ? 'air' : 'ground'
}

function canAct(facts: MatchFacts, slot: number, step: number): boolean {
  return isLive(facts.record, slot, step) && !valueAt(stateOf(facts.record, slot).hitstun, step, false)
}

function secondsByPlace(facts: MatchFacts, slot: number): Record<Place, number> {
  const samples: Record<Place, number> = { air: 0, ground: 0, wall: 0 }

  for (let step = facts.record.startStep; step < facts.record.endStep; step += sampleEverySteps) {
    if (canAct(facts, slot, step)) samples[placeAt(facts, slot, step)] += 1
  }

  const secondsPerSample = (sampleEverySteps * facts.record.stepMs) / 1000

  return {
    air: samples.air * secondsPerSample,
    ground: samples.ground * secondsPerSample,
    wall: samples.wall * secondsPerSample,
  }
}

function placeOption(facts: MatchFacts, slot: number, place: Place, seconds: number): HabitOption {
  const eaten = facts.blows.filter((blow) => blow.target === slot && placeAt(facts, slot, blow.step - 1) === place)

  return {
    key: place,
    label: placeLabels[place],
    count: Math.round(seconds),
    punished: eaten.length,
    costDamage: eaten.reduce((total, blow) => total + blow.damage, 0),
  }
}

// the air is the option this habit is about, so it is the top one whatever its share
export function airHabit(facts: MatchFacts, slot: number): Habit {
  const seconds = secondsByPlace(facts, slot)
  const places = Object.keys(placeLabels) as Place[]
  const options = places.map((place) => placeOption(facts, slot, place, seconds[place]))
  const total = options.reduce((sum, option) => sum + option.count, 0)
  const air = options[0] as HabitOption
  const share = total > 0 ? air.count / total : 0

  return {
    key: 'air',
    situation: 'Time in the air',
    unit: 'seconds',
    layout: 'bar',
    options,
    total,
    top: air,
    share,
    punished: air.punished,
    costDamage: air.costDamage,
    isFlagged: share >= mostlyAirborneShare,
    moments: [],
  }
}

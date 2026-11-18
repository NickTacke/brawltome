import type { Lead, Punish } from '@brawltome/contracts'
import { playerOf } from './events'
import type { MatchFacts } from './facts'
import type { AttackEvent, LineEvent } from './line'
import { moveLabel } from './move-names'
import { stateOf } from './record'
import { lastBecameWithin, valueAt } from './series'
import { weaponLabel } from './weapon-names'

// how an opening began, read straight from the target's own state and events at the step of the first hit. every
// kind is something the line records; nothing is inferred from windows wider than half a second

// a swing or the attacker's own move can start this long before the hit and still be the one in play
const swingSteps = 90
const dodgeSteps = 30
const landingSteps = 8
const movementSteps = 30
const tradeSteps = 10

const movementWords: Record<string, string> = { jump: 'jumped', dash: 'dashed', throw: 'threw a weapon' }

type Found = Pick<Lead, 'kind' | 'action' | 'beforeMs'>

function lastEvent(facts: MatchFacts, slot: number, types: string[], fromStep: number, beforeStep: number) {
  return facts.record.events.findLast(
    (event) =>
      playerOf(event) === slot && types.includes(event.type) && event.step >= fromStep && event.step < beforeStep,
  )
}

// a move the page has a name for reads like "side light"; anything else is the game's internal name
const namedMove = /^[A-Z][a-z]+( [a-z]+)*$/

function swingName(attack: AttackEvent): string {
  const move = moveLabel(attack.move)
  const weapon = weaponLabel(attack.weapon)

  return namedMove.test(move) ? `${weapon} ${move.toLowerCase()}` : `${weapon} attack`
}

function msBefore(facts: MatchFacts, hitStep: number, step: number): number {
  return (hitStep - step) * facts.record.stepMs
}

function tradeLead(facts: MatchFacts, punish: Punish): Found {
  const answer = facts.blows.find(
    (blow) =>
      blow.attacker === punish.target &&
      blow.target === punish.attacker &&
      Math.abs(blow.step - punish.startStep) <= tradeSteps,
  )

  const gapSteps = answer ? Math.abs(answer.step - punish.startStep) : null

  return { kind: 'trade', action: null, beforeMs: gapSteps === null ? null : gapSteps * facts.record.stepMs }
}

function swingLead(facts: MatchFacts, punish: Punish): Found | null {
  const hitStep = punish.startStep
  const move = valueAt(stateOf(facts.record, punish.target).move, hitStep - 1, '')
  const attack = lastEvent(facts, punish.target, ['attack'], hitStep - swingSteps, hitStep)

  if (move === '' || move.startsWith('ChargeThrow') || attack?.type !== 'attack') return null

  const kind = move.includes('Miss') ? 'whiff' : 'swing'

  return { kind, action: swingName(attack), beforeMs: msBefore(facts, hitStep, attack.step) }
}

function dodgeLead(facts: MatchFacts, punish: Punish): Found | null {
  const hitStep = punish.startStep
  const dodge = lastEvent(facts, punish.target, ['dodge'], hitStep - dodgeSteps, hitStep)

  if (dodge?.type !== 'dodge') return null

  const direction = dodge.direction.replace('-', ' and ')
  const action = direction === '' || direction === 'none' ? 'on the spot' : direction

  return { kind: 'dodge', action, beforeMs: msBefore(facts, hitStep, dodge.step) }
}

function landingLead(facts: MatchFacts, punish: Punish): Found | null {
  const hitStep = punish.startStep
  const inAir = stateOf(facts.record, punish.target).inAir
  const landed = lastBecameWithin(inAir, false, hitStep - landingSteps, hitStep - 1)

  if (landed === null) return null

  return { kind: 'landing', action: null, beforeMs: msBefore(facts, hitStep, landed) }
}

function freeLead(facts: MatchFacts, punish: Punish): Found {
  const hitStep = punish.startStep

  const movement: LineEvent | undefined = lastEvent(
    facts,
    punish.target,
    ['jump', 'dash', 'throw'],
    hitStep - movementSteps,
    hitStep,
  )

  if (!movement) return { kind: 'free', action: null, beforeMs: null }

  return {
    kind: 'free',
    action: movementWords[movement.type] ?? null,
    beforeMs: msBefore(facts, hitStep, movement.step),
  }
}

function findLead(facts: MatchFacts, punish: Punish): Found {
  if (punish.cause === 'throw') return { kind: 'throw', action: null, beforeMs: null }

  if (punish.cause === 'trade') return tradeLead(facts, punish)

  return swingLead(facts, punish) ?? dodgeLead(facts, punish) ?? landingLead(facts, punish) ?? freeLead(facts, punish)
}

/** What the target was doing when the first hit of a punish landed. */
export function readLead(facts: MatchFacts, punish: Punish): Lead {
  const hitStep = punish.startStep
  const isThrown = punish.cause === 'throw'
  const attack = isThrown ? undefined : lastEvent(facts, punish.attacker, ['attack'], hitStep - swingSteps, hitStep + 1)

  return {
    ...findLead(facts, punish),
    wasInAir: valueAt(stateOf(facts.record, punish.target).inAir, hitStep - 1, false),
    attackBeforeMs: attack ? msBefore(facts, hitStep, attack.step) : null,
  }
}

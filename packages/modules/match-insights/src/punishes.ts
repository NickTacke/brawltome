import type { Punish } from '@brawltome/contracts'
import type { Blow } from './blows'
import { openingCause, tradeSteps } from './punish-cause'
import { type MatchRecord, stateOf, toMs } from './record'
import { lastBecameWithin, valueAt } from './series'

// openings and the punishes that follow them. an opening is the first hit on a player who had not been hit by that
// attacker for a while; the punish runs until the hits stop, the target is KO'd or the target hits back

// 1.5 s without a hit and the game is back in neutral
const resetSteps = 90
// a dodge takes two steps to start, so a gap this short still left the target nothing to do
const trueLinkSteps = 2

function isTrueLink(record: MatchRecord, target: number, previousStep: number, step: number): boolean {
  const stunEnded = lastBecameWithin(stateOf(record, target).hitstun, false, previousStep + 1, step)

  return stunEnded === null || step - stunEnded <= trueLinkSteps
}

function openPunish(record: MatchRecord, blow: Blow, cause: Punish['cause']): Punish {
  const damage = stateOf(record, blow.target).damage

  return {
    attacker: blow.attacker,
    target: blow.target,
    startStep: blow.step,
    endStep: blow.lastStep,
    startMs: toMs(record, blow.step),
    endMs: toMs(record, blow.lastStep),
    cause,
    hits: [{ offsetMs: 0, weapon: blow.weapon, move: blow.move, damage: blow.damage, isTrue: false }],
    damage: blow.damage,
    targetDamageFrom: valueAt(damage, blow.step - 1, 0),
    targetDamageTo: valueAt(damage, blow.lastStep, 0),
    isKo: false,
    wasReversed: false,
  }
}

function extendPunish(record: MatchRecord, punish: Punish, blow: Blow) {
  punish.hits.push({
    offsetMs: toMs(record, blow.step) - punish.startMs,
    weapon: blow.weapon,
    move: blow.move,
    damage: blow.damage,
    isTrue: isTrueLink(record, blow.target, punish.endStep, blow.step),
  })

  punish.damage += blow.damage
  punish.endStep = blow.lastStep
  punish.endMs = toMs(record, blow.lastStep)
  punish.targetDamageTo = valueAt(stateOf(record, blow.target).damage, blow.lastStep, punish.targetDamageTo)
}

// the punishes the blow's target was running on anyone end here: the target took a hit back
function reverseOpenPunishes(open: Map<string, Punish>, blow: Blow): boolean {
  let isReversal = false

  for (const [key, punish] of open) {
    if (punish.attacker !== blow.target || blow.step - punish.endStep > resetSteps) continue

    if (blow.step - punish.endStep > tradeSteps) punish.wasReversed = true

    open.delete(key)
    isReversal = true
  }

  return isReversal
}

// the KO goes to the killer's last punish on the victim before it
function markKos(record: MatchRecord, punishes: Punish[]) {
  for (const event of record.events) {
    if (event.type !== 'ko' || event.killer === null) continue

    const { killer, player, step } = event

    const last = punishes.findLast(
      (punish) => punish.target === player && punish.attacker === killer && punish.endStep <= step,
    )

    if (!last) continue

    last.isKo = true
    last.targetDamageTo = event.damage
  }
}

/** Every punish in the match, in the order they began. */
export function readPunishes(record: MatchRecord, blows: Blow[]): Punish[] {
  const punishes: Punish[] = []
  const open = new Map<string, Punish>()

  for (const blow of blows) {
    const key = `${blow.attacker}>${blow.target}`
    const current = open.get(key)
    const isReversal = reverseOpenPunishes(open, blow)

    if (current && blow.step - current.endStep <= resetSteps) {
      extendPunish(record, current, blow)
      continue
    }

    const punish = openPunish(record, blow, openingCause(record, blow, blows, isReversal))

    open.set(key, punish)
    punishes.push(punish)
  }

  markKos(record, punishes)

  return punishes
}

/** The punish a blow belongs to, by its index in the match's punishes, or null. */
export function punishIndexOfBlow(punishes: Punish[], blow: Blow): number | null {
  const index = punishes.findIndex(
    (punish) =>
      punish.attacker === blow.attacker &&
      punish.target === blow.target &&
      punish.startStep <= blow.step &&
      punish.endStep >= blow.lastStep,
  )

  return index < 0 ? null : index
}

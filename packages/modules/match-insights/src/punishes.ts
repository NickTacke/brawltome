import type { Punish } from '@brawltome/contracts'
import type { Blow } from './blows'
import { kosOf } from './events'
import type { KoEvent } from './line'
import { openingCause, tradeSteps } from './punish-cause'
import { type MatchRecord, stateOf, toMs } from './record'
import { lastBecameWithin, valueAt } from './series'

// openings and the punishes that follow them. an opening is the first hit on a player who had not been hit by that
// attacker for a while; the punish runs until the attacker goes the reset gap without a hit on the target, or an
// enemy hits the attacker. a KO doesn't end it, but the respawn that follows is longer than the gap

// 1.5 s without a hit and the game is back in neutral; a KO later than this after a punish's last hit isn't its KO
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

// any punish the blow's target was running ends here: its attacker took a hit
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

// the KO goes to the killer's last punish on the victim, when it ended at most the reset gap before and no earlier
// KO took it
function koPunishOf(event: KoEvent, punishes: Punish[], taken: Set<number>): number | null {
  const { killer, player, step } = event

  const index = punishes.findLastIndex(
    (punish) =>
      punish.target === player &&
      punish.attacker === killer &&
      punish.endStep <= step &&
      step - punish.endStep <= resetSteps,
  )

  return index < 0 || taken.has(index) ? null : index
}

// one entry per KO of the match, in order: the index of the punish that ended in it, or null
function linkKos(record: MatchRecord, punishes: Punish[]): (number | null)[] {
  const taken = new Set<number>()

  return kosOf(record).map((event) => {
    const index = event.killer === null ? null : koPunishOf(event, punishes, taken)
    const punish = index === null ? undefined : punishes[index]

    if (index === null || !punish) return null

    taken.add(index)
    punish.isKo = true
    punish.targetDamageTo = event.damage

    return index
  })
}

export type PunishReading = { punishes: Punish[]; koPunishes: (number | null)[] }

/** Every punish in the match, in the order they began, and which one each KO ended. */
export function readPunishes(record: MatchRecord, blows: Blow[]): PunishReading {
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

  return { punishes, koPunishes: linkKos(record, punishes) }
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

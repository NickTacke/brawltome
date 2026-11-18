import { areEnemies, eventsOf, type RawEvent, type RawLine } from './derive'
import { damageAt } from './derive-state'
import { isFromSwing } from './derive-swings'

// what a punish should hold, worked out from the hit and KO events alone

export type PunishSpan = { attacker: number; target: number; startStep: number; endStep: number }

/** Every enemy hit from the attacker on the target from the first step of a punish to its last. */
export function hitsWithin(line: RawLine, span: PunishSpan): RawEvent[] {
  return eventsOf(line, 'hit').filter(
    (hit) =>
      hit.attacker === span.attacker &&
      hit.target === span.target &&
      hit.step >= span.startStep &&
      hit.step <= span.endStep,
  )
}

// a hit belongs to the swing its attacker started last when it came from that swing; anything thrown that hit on one
// step is one throw
function ownerOf(line: RawLine, hit: RawEvent): string {
  const index = line.timeline.events.indexOf(hit)

  const attack = line.timeline.events.findLast(
    (event, at) => at < index && event.type === 'attack' && event.player === hit.attacker,
  )

  if (attack && isFromSwing(hit, attack)) return `attack@${line.timeline.events.indexOf(attack)}`

  return `throw@${hit.step}@${hit.weapon}`
}

/** How many separate swings and throws the hits came from: a multi-hit move counts once. */
export function swingCount(line: RawLine, hits: RawEvent[]): number {
  return new Set(hits.map((hit) => ownerOf(line, hit))).size
}

/** The target's damage just before the punish's first hit. */
export function damageBefore(line: RawLine, span: PunishSpan): number {
  return damageAt(line, span.target, span.startStep - 1)
}

// 1.5 s without a hit and the game is back in neutral: the gap that ends a punish, and the longest a KO can come
// after a punish's last hit and still be its KO
export const resetSteps = 90

/** The step of the last hit from the attacker on the target inside a punish, from the hit events. */
export function lastHitStep(line: RawLine, span: PunishSpan): number {
  return Math.max(...hitsWithin(line, span).map((hit) => hit.step))
}

/**
 * Whether the attacker KO'd the target within the reset gap after the punish's last hit, with no later punish of
 * theirs on the target landing in between.
 */
export function endsInKo(line: RawLine, span: PunishSpan, spans: PunishSpan[]): boolean {
  const lastStep = lastHitStep(line, span)

  const ko = eventsOf(line, 'ko').find(
    (event) =>
      event.player === span.target &&
      event.killer === span.attacker &&
      event.step >= lastStep &&
      event.step - lastStep <= resetSteps,
  )

  if (!ko) return false

  const pairSpans = spans.filter((other) => other.attacker === span.attacker && other.target === span.target)

  return !pairSpans.some((other) => {
    const otherLast = lastHitStep(line, other)

    return otherLast > lastStep && otherLast <= ko.step
  })
}

/** Whether any enemy hit at all lands from one player on another. */
export function isEnemyHit(line: RawLine, hit: RawEvent): boolean {
  return areEnemies(line, hit.attacker ?? 0, hit.target ?? 0)
}

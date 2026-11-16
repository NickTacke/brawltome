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

/** Whether the punish is the attacker's last on the target before the attacker KO'd them. */
export function endsInKo(line: RawLine, span: PunishSpan, spans: PunishSpan[]): boolean {
  const ko = eventsOf(line, 'ko').find(
    (event) => event.player === span.target && event.killer === span.attacker && event.step >= span.endStep,
  )

  if (!ko) return false

  const later = spans.find(
    (other) =>
      other.attacker === span.attacker &&
      other.target === span.target &&
      other.startStep > span.startStep &&
      other.endStep <= ko.step,
  )

  return later === undefined
}

/** Whether any enemy hit at all lands from one player on another. */
export function isEnemyHit(line: RawLine, hit: RawEvent): boolean {
  return areEnemies(line, hit.attacker ?? 0, hit.target ?? 0)
}

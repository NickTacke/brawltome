import { areEnemies, enemyHits, type RawEvent, type RawLine } from './derive'

// which swings landed, told apart from thrown weapons and items, from the attack and hit events

export type Swing = { attack: RawEvent; isLanded: boolean }

/** Whether a hit came from the swing itself: its own weapon, or a clash, which names none. */
export function isFromSwing(hit: RawEvent, attack: RawEvent | undefined): boolean {
  return attack !== undefined && (hit.weapon === attack.weapon || isClash(hit))
}

// a swing landed when an enemy took a hit from the swung weapon before the player's next swing began; a spike ball or
// thrown weapon landing meanwhile is not the swing's
export function swingsOf(line: RawLine, slot: number): Swing[] {
  const events = line.timeline.events
  const starts = events.flatMap((event, index) => (event.type === 'attack' && event.player === slot ? [index] : []))

  return starts.map((start, order) => {
    const until = starts[order + 1] ?? events.length
    const between = events.slice(start + 1, until)

    const attack = events[start] as RawEvent

    const isLanded = between.some(
      (event) =>
        event.type === 'hit' &&
        event.attacker === slot &&
        areEnemies(line, slot, event.target ?? 0) &&
        isFromSwing(event, attack),
    )

    return { attack, isLanded }
  })
}

/** The share of the larger part of a split, as a habit's top option has it. */
export function topShare(first: number, second: number): number | null {
  const total = first + second

  return total > 0 ? Math.max(first, second) / total : null
}

export function isClash(hit: RawEvent): boolean {
  return String(hit.move).startsWith('Clash')
}

/** The enemy hits a player landed with something thrown rather than the swing in play; a clash is never thrown. */
export function thrownHits(line: RawLine, slot: number): RawEvent[] {
  const events = line.timeline.events

  return enemyHits(line, slot).filter((hit) => {
    const index = events.indexOf(hit)
    const attack = events.findLast((event, at) => at < index && event.type === 'attack' && event.player === slot)

    return !isClash(hit) && !isFromSwing(hit, attack)
  })
}

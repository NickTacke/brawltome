import type { DodgeEvent, HitEvent, KoEvent, LineEvent } from './line'
import type { MatchRecord } from './record'

// the events of one type, typed as that type

export function kosOf(record: MatchRecord): KoEvent[] {
  return record.events.filter((event): event is KoEvent => event.type === 'ko')
}

export function hitsOf(record: MatchRecord): HitEvent[] {
  return record.events.filter((event): event is HitEvent => event.type === 'hit')
}

export function dodgesOf(record: MatchRecord, slot: number): DodgeEvent[] {
  return record.events.filter((event): event is DodgeEvent => event.type === 'dodge' && event.player === slot)
}

/** The player an event is about, or null for a hit, which has an attacker and a target instead. */
export function playerOf(event: LineEvent): number | null {
  return 'player' in event ? event.player : null
}

/** A chase dodge is the fast one the game grants after landing a hit. */
export function isChaseDodge(dodge: DodgeEvent): boolean {
  return dodge.kind.startsWith('Fast')
}

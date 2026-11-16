import type { Line, LineEvent, LinePlayer, PlayerState, Track } from './line'
import { type PlayerStats, readPlayerStats } from './player-stats'
import { valueAt } from './series'

// one match line, read once into what every reading of it starts from

export type MatchRecord = {
  line: Line
  // the replay's file name without its extension
  replay: string
  // whether the line names the animations its state points at, so the legends can be drawn
  hasAnimations: boolean
  stepMs: number
  startStep: number
  endStep: number
  durationMs: number
  hasTeams: boolean
  players: LinePlayer[]
  events: LineEvent[]
  states: Map<number, PlayerState>
  tracks: Map<number, Track>
  positionEvery: number
  stats: Map<number, PlayerStats>
}

function stateOfLine(line: Line, slot: number): PlayerState {
  const state = line.timeline.state[String(slot)]

  if (!state) throw new Error(`read the timeline of slot ${slot}: the line has no state for it`)

  return state
}

export function readRecord(line: Line): MatchRecord {
  const { timeline } = line
  const slots = line.match.players.map((player) => player.slot)
  const { every, ...tracks } = timeline.positions

  return {
    line,
    replay: (line.replay ?? '').replace(/\.replay$/, ''),
    hasAnimations: timeline.animations !== undefined,
    stepMs: timeline.stepMs,
    startStep: timeline.startStep,
    endStep: timeline.endStep,
    durationMs: line.stats.GameDuration,
    hasTeams: line.match.rules.hasTeams,
    players: line.match.players,
    events: timeline.events,
    states: new Map(slots.map((slot) => [slot, stateOfLine(line, slot)])),
    tracks: new Map(slots.flatMap((slot) => (tracks[String(slot)] ? [[slot, tracks[String(slot)] as Track]] : []))),
    positionEvery: every,
    stats: new Map(slots.map((slot) => [slot, readPlayerStats(line, slot)])),
  }
}

export function toMs(record: MatchRecord, step: number): number {
  return Math.max(0, (step - record.startStep) * record.stepMs)
}

export function stateOf(record: MatchRecord, slot: number): PlayerState {
  const state = record.states.get(slot)

  if (!state) throw new Error(`read replay state for slot ${slot}: not in the record`)

  return state
}

export function statsOf(record: MatchRecord, slot: number): PlayerStats {
  const stats = record.stats.get(slot)

  if (!stats) throw new Error(`read stats for slot ${slot}: not in the record`)

  return stats
}

/** The team in a team match, the player's own slot otherwise. */
export function sideOf(record: MatchRecord, slot: number): number {
  const player = record.players.find((entry) => entry.slot === slot)

  return record.hasTeams ? (player?.team ?? slot) : slot
}

export function areEnemies(record: MatchRecord, left: number, right: number): boolean {
  return left !== right && sideOf(record, left) !== sideOf(record, right)
}

export function isLive(record: MatchRecord, slot: number, step: number): boolean {
  return valueAt(stateOf(record, slot).status, step, '') === 'live'
}

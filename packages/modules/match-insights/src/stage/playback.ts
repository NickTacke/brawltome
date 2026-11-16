import type { AnimationShown, Playback, PlaybackPlayer, StageBox } from '@brawltome/contracts'
import type { Series } from '../line'
import { type MatchRecord, stateOf, toMs } from '../record'
import { toOpenShare } from './stage-box'

// what playing a match back needs: where every player was at each position sample, and their state as lists of
// changes over time

type Changes<Value> = [number, Value][]

function changesOf<Value>(record: MatchRecord, series: Series<Value>): Changes<Value> {
  return series.map(([step, value]): [number, Value] => [toMs(record, step), value])
}

// unclamped: the frame shown is counted from when an animation began, which can be before the match started
function animationsOf(record: MatchRecord, slot: number): Changes<AnimationShown> {
  const runs = record.hasAnimations ? (stateOf(record, slot).animation ?? []) : []

  return runs.map(([step, index, frame, framesPerStep]): [number, AnimationShown] => [
    (step - record.startStep) * record.stepMs,
    index === null ? null : [index, frame, framesPerStep],
  ])
}

// a launched player keeps flying past the edge instead of sticking to it
function positionsOf(record: MatchRecord, box: StageBox, slot: number): { x: number[]; y: number[] } {
  const track = record.tracks.get(slot)
  const x: number[] = []
  const y: number[] = []

  for (let step = record.startStep; step < record.endStep; step += record.positionEvery) {
    const index = Math.round((step - (track?.from ?? 0)) / record.positionEvery)
    const [shareX, shareY] = toOpenShare(box, { x: track?.x[index] ?? 0, y: track?.y[index] ?? 0 })

    x.push(shareX)
    y.push(shareY)
  }

  return { x, y }
}

function playerOf(record: MatchRecord, box: StageBox, slot: number): PlaybackPlayer {
  const state = stateOf(record, slot)
  const isLive = state.status.map(([step, status]): [number, boolean] => [step, status === 'live' || status === 'held'])

  return {
    slot,
    ...positionsOf(record, box, slot),
    isLive: changesOf(record, isLive),
    facingRight: changesOf(record, state.facingRight),
    weapon: changesOf(record, state.weapon),
    move: changesOf(record, state.move),
    damage: changesOf(record, state.damage),
    stocksLeft: changesOf(record, state.stocks),
    isInAir: changesOf(record, state.inAir),
    isHitstun: changesOf(record, state.hitstun),
    isDodging: changesOf(record, state.dodging),
    animation: animationsOf(record, slot),
  }
}

export function readPlayback(record: MatchRecord, box: StageBox): Playback {
  return {
    sampleMs: record.positionEvery * record.stepMs,
    stepMs: record.stepMs,
    durationMs: toMs(record, record.endStep),
    players: record.players.map((player) => playerOf(record, box, player.slot)),
    replay: record.replay,
    hasAnimations: record.hasAnimations,
    box,
  }
}

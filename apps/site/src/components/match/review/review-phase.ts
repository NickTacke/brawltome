import type { Moment } from '@brawltome/contracts'

// where a review stands against the clock: heading for a stop, slowing into it, stopped on it, or played on past it

// the replay stops a few frames after the first hit, so the hit itself is on screen
export const holdMs = 60
// the last stretch before the hit plays slowed down, so the eye is there when it lands
const easeMs = 450
// scrubbing further than this from the stop ends the explanation
const nearMs = 500

export type ReviewState = {
  stops: Moment[]
  index: number
  // true from a stop being headed for until the replay has stopped on it
  isArriving: boolean
  timeMs: number
  isPlaying: boolean
  isOn: boolean
}

export type ReviewPhase = {
  stop: Moment | null
  // the clock has reached the stop it was heading for: time to stop on it
  hasArrived: boolean
  // the last stretch before the stop, played slowed down
  isEasing: boolean
  // the replay played on from a stop, so it heads for the next one
  hasPlayedOn: boolean
  // standing on the stop, which is explained
  isStopped: boolean
  // the stop "back" goes to: the one before when on or heading for a stop, else the last one passed
  backIndex: number
}

/** Where the review stands, worked out from its state and the clock alone. */
export function reviewPhaseOf({ stops, index, isArriving, timeMs, isPlaying, isOn }: ReviewState): ReviewPhase {
  const stop = stops[index] ?? null
  const hasNext = index + 1 < stops.length
  const untilStopMs = stop ? stop.timeMs + holdMs - timeMs : null
  const isHeading = isOn && isArriving && untilStopMs !== null
  // before the first stop there is none to play on from, and the first is the next
  const isPastStop = untilStopMs === null || untilStopMs < -nearMs
  const isNear = untilStopMs !== null && Math.abs(untilStopMs) < nearMs

  return {
    stop,
    hasArrived: isHeading && untilStopMs <= 0,
    isEasing: isHeading && untilStopMs > 0 && untilStopMs < easeMs,
    hasPlayedOn: isOn && !isArriving && isPlaying && hasNext && isPastStop,
    isStopped: isOn && !isArriving && !isPlaying && isNear,
    backIndex: isNear || isArriving ? index - 1 : index,
  }
}

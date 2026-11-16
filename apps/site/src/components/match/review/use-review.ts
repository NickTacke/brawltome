import type { Moment } from '@brawltome/contracts'
import { useEffect, useState } from 'react'
import type { Playback } from '../stage/use-playback'
import { holdMs, type ReviewPhase, reviewPhaseOf } from './review-phase'

// the replay starts this long before a stop, so what led up to it is seen
const leadInMs = 1500
const easeScale = 0.3

type Pacing = { phase: ReviewPhase; playback: Playback; index: number }
type Moves = { setIndex: (index: number) => void; setIsArriving: (isArriving: boolean) => void }

/** Plays into a time from a little before it, so what led up to it is seen. */
export function playInto(playback: Playback, timeMs: number) {
  playback.seek(timeMs - leadInMs)
  playback.play()
}

// what the clock does along the way: slows into a stop, stops on it, and heads for the next one once played on
function useReviewPacing({ phase, playback, index }: Pacing, { setIndex, setIsArriving }: Moves) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: stops once, at the frame the replay reaches the moment
  useEffect(() => {
    if (!phase.hasArrived || !phase.stop) return

    // a slow frame can run past the hit, so the clock is put back on it
    playback.seek(phase.stop.timeMs + holdMs)
    playback.pause()
    setIsArriving(false)
  }, [phase.hasArrived])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the clock only changes pace when the easing starts or ends
  useEffect(() => playback.setScale(phase.isEasing ? easeScale : 1), [phase.isEasing])

  // biome-ignore lint/correctness/useExhaustiveDependencies: heads on once per stop played past
  useEffect(() => {
    if (!phase.hasPlayedOn) return

    setIndex(index + 1)
    setIsArriving(true)
  }, [phase.hasPlayedOn, index])
}

/** Steps through stops one at a time: plays into each, slows just before its first hit, stops on it, and waits. */
export function useReview(stops: Moment[], playback: Playback, isOn: boolean) {
  const [index, setIndex] = useState(0)
  const [isArriving, setIsArriving] = useState(false)
  const { timeMs, isPlaying } = playback
  const phase = reviewPhaseOf({ stops, index, isArriving, timeMs, isPlaying, isOn })

  useReviewPacing({ phase, playback, index }, { setIndex, setIsArriving })

  function goTo(target: number, from: Moment[] = stops) {
    const moment = from[target]

    if (!moment) return

    setIndex(target)
    setIsArriving(true)
    playInto(playback, moment.timeMs)
  }

  /** Heads for the first stop still ahead of the clock, so turning the review on doesn't rewind the match. */
  function start(from: Moment[] = stops) {
    const ahead = from.findIndex((moment) => moment.timeMs > timeMs)

    goTo(Math.max(ahead, 0), from)
  }

  /**
   * The clock was moved by hand. The stop being headed for is let go of, or the replay would jump back to it, and the
   * review carries on from the last stop the clock has passed: none, before the first one.
   */
  function release(releasedMs: number) {
    setIsArriving(false)
    setIndex(stops.findLastIndex((moment) => moment.timeMs + holdMs <= releasedMs))
  }

  return {
    index,
    stop: phase.stop,
    isStopped: phase.isStopped,
    canStepBack: phase.backIndex >= 0,
    canStepOn: index + 1 < stops.length,
    goTo,
    start,
    // one stop on or back, from the stop it is on or, after scrubbing away, from where the clock is
    step: (direction: -1 | 1) => goTo(direction === 1 ? index + 1 : phase.backIndex),
    release,
  }
}

export type Review = ReturnType<typeof useReview>

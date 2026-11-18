import type { MatchInsights, Moment, ReviewScope } from '@brawltome/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Stepping, StopCount } from '../stage/ReviewControls'
import type { Playback } from '../stage/use-playback'
import { reviewChoicesOf } from './review-stops'
import { type Review, useReview } from './use-review'

const stepMs = 2000
const longStepMs = 10_000
// watching has no stops; one list, so the timeline isn't handed a new one every frame
const noStops: Moment[] = []

// the same two buttons step through time while watching and through the stops in a review, as the arrow keys do
function steppingOf(isReview: boolean, review: Review, playback: Playback, onStep: Stepping['onStep']): Stepping {
  if (isReview) {
    const { canStepBack, canStepOn } = review

    return { backLabel: 'Previous stop', onLabel: 'Next stop', canStepBack, canStepOn, onStep }
  }

  return {
    backLabel: `Back ${stepMs / 1000} s`,
    onLabel: `On ${stepMs / 1000} s`,
    canStepBack: playback.timeMs > 0,
    canStepOn: playback.timeMs < playback.durationMs,
    onStep,
  }
}

// picking another player keeps the clock and the loaded legends; a running review heads for their next stop
function useRestartOnPlayer(selectedSlot: number, restart: () => void) {
  const reviewedSlot = useRef(selectedSlot)

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of player restarts the review
  useEffect(() => {
    if (reviewedSlot.current === selectedSlot) return

    reviewedSlot.current = selectedSlot
    restart()
  }, [selectedSlot])
}

/**
 * Watching or reviewing the replay for the picked player. Watching, the clock runs and steps in seconds; reviewing,
 * it stops on each of the player's stops, and steps from stop to stop.
 */
export function useReviewMode(insights: MatchInsights, selectedSlot: number, playback: Playback) {
  const [isReview, setIsReview] = useState(false)
  const [scope, setScope] = useState<ReviewScope>('key')
  const choices = useMemo(() => reviewChoicesOf(insights, selectedSlot), [insights, selectedSlot])
  const stops = choices.find((choice) => choice.key === scope)?.stops ?? noStops
  const review = useReview(stops, playback, isReview)

  useRestartOnPlayer(selectedSlot, () => {
    if (isReview) review.start(stops)
  })

  function switchMode(toReview: boolean) {
    setIsReview(toReview)

    if (toReview) review.start()
  }

  function pickScope(key: ReviewScope) {
    setScope(key)
    review.start(choices.find((choice) => choice.key === key)?.stops ?? noStops)
  }

  function step(direction: -1 | 1, isLong = false) {
    if (isReview) return review.step(direction)

    playback.seek(playback.timeMs + direction * (isLong ? longStepMs : stepMs))
  }

  // the clock moved by hand, on the timeline; a review then carries on from there
  function seekByHand(timeMs: number) {
    playback.seek(timeMs)

    if (isReview) review.release(timeMs)
  }

  const count: StopCount = { index: review.index, total: stops.length, onReplay: () => review.goTo(review.index) }

  return {
    isReview,
    choices,
    scope,
    // the stops shown along the lanes: none while watching
    stops: isReview ? stops : noStops,
    review,
    // the stop the replay stands on, which the card explains
    explained: isReview && review.isStopped ? review.stop : null,
    count: isReview ? count : null,
    stepping: steppingOf(isReview, review, playback, step),
    switchMode,
    pickScope,
    step,
    seekByHand,
    leave: () => setIsReview(false),
  }
}

export type ReviewMode = ReturnType<typeof useReviewMode>

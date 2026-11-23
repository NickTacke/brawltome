import type { Moment } from '@brawltome/contracts'
import { useLayoutEffect, useRef, useState } from 'react'
import { slotColour } from '../match-styles'
import { bodyPxOf } from '../stage/body-ring'
import { inFrame, unitInFrame, useStageView } from '../stage/play-camera'
import type { Pose } from '../stage/pose'
import type { StopCount } from '../stage/ReviewControls'
import { useStageBox } from '../stage/use-stage-box'
import { type CardSpace, lineToRing, placeCard, type Rect } from './callout-place'
import { LeaderLine } from './LeaderLine'
import type { LanePlayer } from './lane-players'
import { ReviewCard } from './ReviewCard'

// the upright card is narrower on a laptop's stage; the wide one is a low strip that fits over or under players who
// stand apart across the middle of the stage
const uprightCard = 'w-64 p-3 @[40rem]:w-72'
const wideCard = 'w-[30rem] max-w-[calc(100%-1rem)] px-3 py-2'

type ReviewCalloutProps = {
  moment: Moment
  lanes: LanePlayer[]
  poses: Pose[]
  count: StopCount
  // what else lies on the stage: the lanes along an edge, and what its corners hold
  panel: CardSpace['panel']
  obstacles: Rect[]
}

/**
 * The stop explained on the stage itself: a card where the stop's players are not, with a line to the one who got
 * hit. It always lies inside the stage and off the lanes, so neither the page around the replay nor the lanes ever
 * move or hide for it. Where the players leave the upright card no place it turns into a low strip that fits over or
 * under them.
 */
export function ReviewCallout({ moment, lanes, poses, count, panel, obstacles }: ReviewCalloutProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  // the stop the card is wide for
  const [wideKey, setWideKey] = useState<string | null>(null)
  const isWide = wideKey === moment.key
  // measured again when the stop changes, as its hits decide how tall the card is
  const measured = useStageBox(cardRef, `${moment.key} ${isWide}`)
  // the card sits on the frame, not the stage, so the players are placed where the camera shows them
  const { bodies, camera } = useStageView()
  const framed = poses.map((pose) => inFrame(pose, camera))
  // the players are as big as the camera's zoom makes a level unit on the stage as it is laid out
  const unitPx = measured ? measured.stage.width * unitInFrame(bodies.box, camera) : 0
  const body = bodyPxOf(bodies, unitPx)
  const space = measured ? { card: measured.element, stage: measured.stage, body, panel, obstacles } : null
  const place = space ? placeCard(framed, space, { victim: moment.victim, attacker: moment.attacker }) : null
  const hasNoPlace = place?.isOnStopPlayers ?? false

  // an upright card with no place clear of the stop's players becomes the wide one, before it is painted
  useLayoutEffect(() => {
    if (hasNoPlace && !isWide) setWideKey(moment.key)
  }, [hasNoPlace, isWide, moment.key])

  const victim = framed.find((pose) => pose.slot === moment.victim && pose.isInPlay)
  const line = space && place && victim ? lineToRing(place, space, victim) : null

  return (
    <>
      {line ? <LeaderLine {...line} colour={slotColour(moment.victim)} /> : null}
      <div
        ref={cardRef}
        data-review-card
        // out of sight for the one frame it takes to measure it; the pointer goes through it to the stage
        className={`pointer-events-none absolute z-30 ${isWide ? wideCard : uprightCard} rounded-lg bg-ink/90 ring-1 ring-line/70 backdrop-blur-sm ${place ? '' : 'invisible'}`}
        style={{ left: place?.x ?? 0, top: place?.y ?? 0 }}
      >
        <ReviewCard moment={moment} lanes={lanes} count={count} isWide={isWide} />
      </div>
    </>
  )
}

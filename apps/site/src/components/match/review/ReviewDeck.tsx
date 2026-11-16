import type { Moment } from '@brawltome/contracts'
import { type ReactNode, useRef, useState } from 'react'
import { inFrame, useStageCamera } from '../stage/play-camera'
import type { Pose } from '../stage/pose'
import type { StopCount } from '../stage/ReviewControls'
import { transportCornerPx } from '../stage/StageControls'
import { StageDeck } from '../stage/StageDeck'
import type { Fullscreen } from '../stage/use-fullscreen'
import { type StageBox, useStageBox } from '../stage/use-stage-box'
import type { StageControlsState } from '../stage/use-stage-controls'
import { usePhoneLayout } from '../use-phone-layout'
import type { CardSpace, Rect } from './callout-place'
import type { LanePlayer } from './lane-players'
import { ReviewCallout } from './ReviewCallout'
import { ReviewCardSlot } from './ReviewCardSlot'
import { usePanelPlace } from './use-panel-place'

// size-8 on the fullscreen button, with top-2 and right-2 around it and a little air
const cornerButtonPx = 48
// top-2 and left-2 around the top left corner, and a little air
const cornerAirPx = 16

type ReviewDeckProps = {
  // the stop the replay is standing on, when a review explains one, and its place among the review's stops
  explained: Moment | null
  count: StopCount | null
  isPlaying: boolean
  poses: Pose[]
  lanes: LanePlayer[]
  controls: StageControlsState
  fullscreen: Fullscreen
  transport: ReactNode
  timeline: (opensBelow: boolean) => ReactNode
  speed: ReactNode
  tools: ReactNode
  note: ReactNode
}

// what lies in the stage's corners, for the card to keep clear of: the fullscreen button, the transport, and the
// tools and note in the top left
function cornersOf(stage: { width: number; height: number }, topLeft: StageBox | null): Rect[] {
  const corners = [
    { left: stage.width - cornerButtonPx, top: 0, right: stage.width, bottom: cornerButtonPx },
    { left: 0, top: stage.height - transportCornerPx.height, right: transportCornerPx.width, bottom: stage.height },
  ]

  if (!topLeft || topLeft.element.width === 0) return corners

  const { width, height } = topLeft.element

  return [...corners, { left: 0, top: 0, right: width + cornerAirPx, bottom: height + cornerAirPx }]
}

type CardChoice = Pick<ReviewDeckProps, 'explained' | 'count' | 'lanes' | 'poses'> & {
  isPhone: boolean
  place: CardSpace['panel']
  topLeft: StageBox | null
}

// a phone's card lies under the lanes, in a slot that is there for the whole review; anywhere else the card lies on
// the stage at a stop, once the corners it keeps clear of are measured
function cardOf({ explained, count, lanes, poses, isPhone, place, topLeft }: CardChoice): ReactNode {
  if (!count) return null

  if (isPhone) return <ReviewCardSlot moment={explained} lanes={lanes} count={count} />

  if (!explained || !topLeft) return null

  return (
    <ReviewCallout
      moment={explained}
      lanes={lanes}
      poses={poses}
      count={count}
      panel={place}
      obstacles={cornersOf(topLeft.stage, topLeft)}
    />
  )
}

/**
 * The stage's controls during a review: the lanes give the bottom edge up when the stop's players stand along it and
 * the top is free, and at a stop the card that explains it looks for a place beside everything on the stage. On a
 * phone held upright the lanes and the card lie under the stage, so neither has to keep clear of anyone.
 */
export function ReviewDeck(props: ReviewDeckProps) {
  const { explained, poses, fullscreen } = props
  const panelRef = useRef<HTMLDivElement>(null)
  const topLeftRef = useRef<HTMLDivElement>(null)
  const [isOnLanes, setIsOnLanes] = useState(false)
  const isPhone = usePhoneLayout()
  const topLeft = useStageBox(topLeftRef, String(fullscreen.isOn))
  const camera = useStageCamera()
  // at a stop the lanes keep clear of its two players; on a pause, of everyone
  const isOfStop = (pose: Pose) => pose.slot === explained?.victim || pose.slot === explained?.attacker
  const inPlay = poses.filter((pose) => pose.isInPlay)
  const players = (explained ? inPlay.filter(isOfStop) : inPlay).map((pose) => inFrame(pose, camera))
  const key = explained?.key ?? (props.isPlaying ? null : 'paused')
  const place = usePanelPlace(panelRef, { key, players, isBottomOnly: fullscreen.isOn || isPhone }, isOnLanes)

  const card = cardOf({ ...props, isPhone, place, topLeft })

  return (
    <StageDeck
      controls={props.controls}
      fullscreen={fullscreen}
      lanes={{ edge: place.edge, panelRef, onHeld: setIsOnLanes }}
      transport={props.transport}
      timeline={props.timeline}
      speed={props.speed}
      tools={props.tools}
      note={props.note}
      topLeftRef={topLeftRef}
      card={card}
    />
  )
}

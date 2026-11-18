import type { MatchInsights } from '@brawltome/contracts'
import type { ReactNode, RefObject } from 'react'
import type { CameraMode } from '../stage/camera-mode'
import type { Pose } from '../stage/pose'
import { SpeedButton, TransportColumn } from '../stage/ReviewControls'
import { StageFrame } from '../stage/StageFrame'
import { StagePlay } from '../stage/StagePlay'
import type { Fullscreen } from '../stage/use-fullscreen'
import type { Legends } from '../stage/use-legends'
import type { Playback } from '../stage/use-playback'
import type { StageControlsState } from '../stage/use-stage-controls'
import type { LanePlayer } from './lane-players'
import { MatchTimeline } from './MatchTimeline'
import { ReviewDeck } from './ReviewDeck'
import { ReviewMarkers } from './ReviewMarkers'
import type { ReviewMode } from './use-review-mode'

type ReviewStageProps = {
  insights: MatchInsights
  legends: Legends
  playback: Playback
  controls: StageControlsState
  fullscreen: Fullscreen
  frameRef: RefObject<HTMLDivElement | null>
  cameraMode: CameraMode
  mode: ReviewMode
  selectedSlot: number
  poses: Pose[]
  lanes: LanePlayer[]
  tools: ReactNode
}

// a review's stop ringed on the stage while it is headed for, and its hits numbered where they landed once it stands on it
function markersOf({ insights, mode, poses }: ReviewStageProps): ReactNode {
  const { stop } = mode.review

  if (!mode.isReview || !stop) return undefined

  const { explained } = mode

  const hits = explained
    ? insights.insights.stage.marks.hits.filter((hit) => `punish-${hit.punishIndex}` === explained.key)
    : []

  return <ReviewMarkers moment={stop} poses={poses} hits={hits} />
}

/** The stage of the replay, with the lanes and controls on it, and a review's markers and card at its stops. */
export function ReviewStage(props: ReviewStageProps) {
  const { insights, legends, playback, controls, fullscreen, mode } = props

  const timeline = (opensBelow: boolean) => (
    <MatchTimeline
      insights={insights}
      timeline={legends.timeline}
      selectedSlot={props.selectedSlot}
      timeMs={playback.timeMs}
      onSeek={mode.seekByHand}
      stops={mode.stops}
      stopIndex={mode.review.index}
      onGoTo={mode.review.goTo}
      opensBelow={opensBelow}
    />
  )

  return (
    <StageFrame
      frameRef={props.frameRef}
      fullscreen={fullscreen}
      controls={controls}
      aspect={insights.insights.stage.aspect}
    >
      <StagePlay
        insights={insights}
        legends={legends}
        timeMs={playback.timeMs}
        cameraMode={props.cameraMode}
        selectedSlot={props.selectedSlot}
        stageOverlay={markersOf(props)}
        deck={(note) => (
          <ReviewDeck
            explained={mode.explained}
            count={mode.count}
            isPlaying={playback.isPlaying}
            poses={props.poses}
            lanes={props.lanes}
            controls={controls}
            fullscreen={fullscreen}
            transport={<TransportColumn playback={playback} stepping={mode.stepping} count={mode.count} />}
            timeline={timeline}
            speed={<SpeedButton playback={playback} />}
            tools={props.tools}
            note={note}
          />
        )}
        onBuffering={playback.setIsBuffering}
      />
    </StageFrame>
  )
}

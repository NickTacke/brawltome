import type { MatchInsights } from '@brawltome/contracts'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { PickedLead } from '../lead/PickedLead'
import { type CameraMode, defaultCameraMode } from '../stage/camera-mode'
import { type Pose, posesAt } from '../stage/pose'
import { useFullscreen } from '../stage/use-fullscreen'
import type { Legends } from '../stage/use-legends'
import { usePlayback } from '../stage/use-playback'
import { useStageControls } from '../stage/use-stage-controls'
import { useStageKeys } from '../stage/use-stage-keys'
import { lanePlayersOf } from './lane-players'
import { ReplaySection } from './ReplaySection'
import { ReviewStage } from './ReviewStage'
import { ReviewTools } from './ReviewTools'
import { useReviewMode } from './use-review-mode'
import { useWatchRequests } from './use-watch-requests'

const noPoses: Pose[] = []

// the lead stands beside the stage from this width of the replay on; under it on anything narrower
const besideStage = 'shrink-0 @max-[40rem]:hidden'
const underStage = '@[40rem]:hidden'

type ReviewReplayProps = {
  insights: MatchInsights
  // the match's art and playback timeline, loaded by the page, which shows the map's picture from them too
  legends: Legends
  // the player the review is about; picking another restarts a running review but keeps the replay
  selectedSlot: number
}

/**
 * The match's replay, with its controls and lanes on the stage like a video player's. Watching, it plays; reviewing,
 * it stops on each of the picked player's key moments and explains them on the stage.
 */
export function ReviewReplay({ insights, legends, selectedSlot }: ReviewReplayProps) {
  const { stage } = insights.insights
  const playback = usePlayback(stage.durationMs)
  const controls = useStageControls(playback.isPlaying, playback.toggle)
  const frameRef = useRef<HTMLDivElement>(null)
  const fullscreen = useFullscreen(frameRef)
  const [cameraMode, setCameraMode] = useState<CameraMode>(defaultCameraMode)
  const mode = useReviewMode(insights, selectedSlot, playback)
  const lanes = useMemo(() => lanePlayersOf(insights), [insights])
  const poses = legends.timeline ? posesAt(legends.timeline, stage.box, playback.timeMs) : noPoses
  const { review } = mode

  useStageKeys({
    frameRef,
    playback,
    fullscreen,
    onStep: mode.step,
    onUsed: controls.wake,
    onReplayStop: mode.isReview ? () => review.goTo(review.index) : undefined,
    onLeave: mode.isReview ? mode.leave : undefined,
  })

  useWatchRequests(frameRef, playback, mode.seekByHand)

  const tools = (
    <ReviewTools
      isReview={mode.isReview}
      onReview={mode.switchMode}
      choices={mode.choices}
      scope={mode.scope}
      onScope={mode.pickScope}
      // a line without animations always shows the whole stage, so it has no camera to pick
      cameraMode={stage.hasAnimations ? cameraMode : null}
      onCameraMode={setCameraMode}
    />
  )

  const lead = (isUpright: boolean) => (
    <PickedLead
      insights={insights}
      selectedSlot={selectedSlot}
      timeMs={playback.timeMs}
      onSeek={mode.seekByHand}
      isUpright={isUpright}
    />
  )

  const replayStage = (
    <ReviewStage
      insights={insights}
      legends={legends}
      playback={playback}
      controls={controls}
      fullscreen={fullscreen}
      frameRef={frameRef}
      cameraMode={cameraMode}
      mode={mode}
      selectedSlot={selectedSlot}
      poses={poses}
      lanes={lanes}
      tools={tools}
    />
  )

  return (
    <ReplaySection tools={tools}>
      <StageBesideLead stage={replayStage} lead={lead} />
    </ReplaySection>
  )
}

/** The stage with the lead panel standing beside it, or lying under it when the replay is narrow. */
function StageBesideLead({ stage, lead }: { stage: ReactNode; lead: (isUpright: boolean) => ReactNode }) {
  return (
    <>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">{stage}</div>
        <div data-lead="upright" className={besideStage}>
          {lead(true)}
        </div>
      </div>
      <div data-lead="flat" className={underStage}>
        {lead(false)}
      </div>
    </>
  )
}

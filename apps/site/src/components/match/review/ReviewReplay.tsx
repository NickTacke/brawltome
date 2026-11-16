import type { MatchDetailContract, MatchInsights } from '@brawltome/contracts'
import { useMemo, useRef, useState } from 'react'
import { type CameraMode, defaultCameraMode } from '../stage/camera-mode'
import { type Pose, posesAt } from '../stage/pose'
import { useFullscreen } from '../stage/use-fullscreen'
import { useLegends } from '../stage/use-legends'
import { usePlayback } from '../stage/use-playback'
import { useStageControls } from '../stage/use-stage-controls'
import { useStageKeys } from '../stage/use-stage-keys'
import { lanePlayersOf } from './lane-players'
import { ReplaySection } from './ReplaySection'
import { ReviewStage } from './ReviewStage'
import { ReviewTools } from './ReviewTools'
import { useReviewMode } from './use-review-mode'

const noPoses: Pose[] = []

type ReviewReplayProps = {
  insights: MatchInsights
  art: MatchDetailContract['art']
  playbackPath: string | null
  // the player the review is about; picking another restarts a running review but keeps the replay
  selectedSlot: number
}

/**
 * The match's replay, with its controls and lanes on the stage like a video player's. Watching, it plays; reviewing,
 * it stops on each of the picked player's key moments and explains them on the stage.
 */
export function ReviewReplay({ insights, art, playbackPath, selectedSlot }: ReviewReplayProps) {
  const { stage } = insights.insights
  const legends = useLegends(art, playbackPath)
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

  return (
    <ReplaySection tools={tools}>
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
    </ReplaySection>
  )
}

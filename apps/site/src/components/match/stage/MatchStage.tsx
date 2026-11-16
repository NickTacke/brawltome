import type { MatchDetailContract, MatchInsights } from '@brawltome/contracts'
import { useRef, useState } from 'react'
import { sectionTitle } from '../../player/player-styles'
import { CameraSelect } from './CameraSelect'
import { type CameraMode, defaultCameraMode } from './camera-mode'
import { SpeedButton, type Stepping, TransportColumn } from './ReviewControls'
import { StageDeck } from './StageDeck'
import { StageFrame } from './StageFrame'
import { StagePlay } from './StagePlay'
import { useFullscreen } from './use-fullscreen'
import { useLegends } from './use-legends'
import { type Playback, usePlayback } from './use-playback'
import { useStageControls } from './use-stage-controls'
import { useStageKeys } from './use-stage-keys'

const stepMs = 2000
const longStepMs = 10_000

type MatchStageProps = {
  insights: MatchInsights
  art: MatchDetailContract['art']
  playbackPath: string | null
  selectedSlot?: number
}

function steppingOf(playback: Playback, onStep: (direction: -1 | 1) => void): Stepping {
  return {
    backLabel: `Back ${stepMs / 1000} s`,
    onLabel: `On ${stepMs / 1000} s`,
    canStepBack: playback.timeMs > 0,
    canStepOn: playback.timeMs < playback.durationMs,
    onStep,
  }
}

/** The match's replay, with its controls on the stage like a video player's, and the camera to watch it with. */
export function MatchStage({ insights, art, playbackPath, selectedSlot = 1 }: MatchStageProps) {
  const { stage } = insights.insights
  const legends = useLegends(art, playbackPath)
  const playback = usePlayback(stage.durationMs)
  const controls = useStageControls(playback.isPlaying, playback.toggle)
  const frameRef = useRef<HTMLDivElement>(null)
  const fullscreen = useFullscreen(frameRef)
  const [cameraMode, setCameraMode] = useState<CameraMode>(defaultCameraMode)

  function step(direction: -1 | 1, isLong = false) {
    playback.seek(playback.timeMs + direction * (isLong ? longStepMs : stepMs))
  }

  useStageKeys({ frameRef, playback, fullscreen, onStep: step, onUsed: controls.wake })

  // a line without animations always shows the whole stage, so it has no camera to pick
  const tools = stage.hasAnimations ? <CameraSelect mode={cameraMode} onMode={setCameraMode} /> : null
  const transport = <TransportColumn playback={playback} stepping={steppingOf(playback, step)} count={null} />
  const speed = <SpeedButton playback={playback} />

  return (
    // a container, so what sits on the stage can ask how wide the replay is
    <section aria-labelledby="replay" className="@container">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="replay" className={sectionTitle}>
          Replay
        </h2>
        {tools}
      </div>
      <StageFrame frameRef={frameRef} fullscreen={fullscreen} controls={controls} aspect={stage.aspect}>
        <StagePlay
          insights={insights}
          legends={legends}
          timeMs={playback.timeMs}
          cameraMode={cameraMode}
          selectedSlot={selectedSlot}
          deck={(note) => (
            <StageDeck
              controls={controls}
              fullscreen={fullscreen}
              transport={transport}
              timeline={null}
              speed={speed}
              tools={tools}
              note={note}
            />
          )}
          onBuffering={playback.setIsBuffering}
        />
      </StageFrame>
    </section>
  )
}

import type { MatchInsights, Moment, StageTrail } from '@brawltome/contracts'
import type { Replay } from '@brawltome/replay-player'
import { type CSSProperties, memo, type ReactNode, useMemo } from 'react'
import { AnimatedPoses } from './AnimatedPoses'
import type { CameraMode } from './camera-mode'
import { MomentRing } from './MomentRing'
import { PlayEffects } from './PlayEffects'
import { type Camera, inFrame, StageCameraContext } from './play-camera'
import { type Pose, posesAt } from './pose'
import { StageBackdrop, StagePicture, type TimeWindow } from './StagePicture'
import { StageSpinner } from './StageSpinner'
import { cameraNow, cameraPathKey } from './stage-camera'
import { TokenPoses } from './TokenPoses'
import { useCameraBlend } from './use-camera-blend'
import type { Legends } from './use-legends'

// the stage is drawn once; only what sits on top of it changes from frame to frame
const StillStage = memo(StagePicture)
const noTrails: StageTrail[] = []
const noSlots: number[] = []
const ignoreBuffering = () => undefined

type StagePlayProps = {
  insights: MatchInsights
  legends: Legends
  timeMs: number
  cameraMode: CameraMode
  selectedSlot: number
  // the moment on screen, ringed where it is about to happen
  watched?: Moment | null
  // drawn on the stage itself, so it moves with the players; the watched moment's ring unless a page brings its own
  stageOverlay?: ReactNode
  // what lies on the stage over the players: its controls
  deck?: ReactNode
  // where players stood, drawn into the stage itself: whose, and for which part of the match
  trails?: StageTrail[]
  shownSlots?: number[]
  window?: TimeWindow | null
  // true while the moment on screen waits for its art
  onBuffering?: (isBuffering: boolean) => void
}

// the stage's picture is scaled as one layer, which is cheap to move every frame
function pictureStyle(camera: Camera): CSSProperties {
  return { transform: `scale(${camera.zoom}) translate(${-camera.x * 100}%, ${-camera.y * 100}%)` }
}

// marks on the stage are laid out on a layer the size the camera enlarges the stage to, so they land where the
// camera puts their spot but keep their own size
function markLayerStyle(camera: Camera): CSSProperties {
  return {
    left: `${-camera.x * camera.zoom * 100}%`,
    top: `${-camera.y * camera.zoom * 100}%`,
    width: `${camera.zoom * 100}%`,
    height: `${camera.zoom * 100}%`,
  }
}

// the level's background, from the art the replay worker exported; none until it loads, or for a map without one
function backgroundUrlOf(replay: Replay | null): string | null {
  const background = replay?.manifest.background

  if (!replay || !background) return null

  try {
    return replay.assetUrl(background.asset)
  } catch {
    return null
  }
}

// while the legends aren't drawn: why not, or that they are on their way
function LegendsStatus({ legends }: { legends: Legends }) {
  if (legends.state === 'unavailable') {
    return (
      <span className="absolute top-2 left-2 rounded-sm bg-ink/80 px-1.5 text-xs leading-5 text-soft">
        Legends unavailable for this match
      </span>
    )
  }

  if (legends.state === 'loading' && legends.isDownloading) return <StageSpinner label="Loading legends" />

  return null
}

type PlayersProps = Pick<StagePlayProps, 'legends' | 'timeMs' | 'selectedSlot' | 'onBuffering'> & {
  insights: MatchInsights
  poses: Pose[]
  camera: Camera
}

// the players as their legends once the art and timeline are in; their portraits until then, or without art
function Players({ insights, legends, poses, camera, timeMs, selectedSlot, onBuffering }: PlayersProps) {
  const { replay, timeline } = legends
  const drawn = useMemo(() => (replay && timeline ? { replay, timeline } : null), [replay, timeline])

  if (legends.state !== 'ready' || !drawn) {
    const framed = poses.map((pose) => inFrame(pose, camera))

    return <TokenPoses poses={framed} players={insights.summary.players} selectedSlot={selectedSlot} />
  }

  return (
    <AnimatedPoses
      match={drawn}
      poses={poses}
      selectedSlot={selectedSlot}
      box={insights.insights.stage.box}
      camera={camera}
      timeMs={timeMs}
      onBuffering={onBuffering ?? ignoreBuffering}
    />
  )
}

/** The match played back on its stage: the players move, hits flash, and the camera follows the game's. */
export function StagePlay(props: StagePlayProps) {
  const { insights, legends, timeMs } = props
  const { stage } = insights.insights
  const source = { mode: props.cameraMode, legends, stage }
  const camera = useCameraBlend(cameraNow(source, timeMs), cameraPathKey(source))
  const poses = legends.timeline ? posesAt(legends.timeline, stage.box, timeMs) : []
  const backgroundUrl = backgroundUrlOf(legends.replay)

  return (
    <StageCameraContext.Provider value={camera}>
      <div className="relative overflow-hidden rounded-lg bg-black/[0.14]">
        {backgroundUrl ? <StageBackdrop imageUrl={backgroundUrl} /> : null}
        {/* the level, moved by the camera over the fixed background */}
        <div className="relative origin-top-left" style={pictureStyle(camera)}>
          <StillStage
            stage={stage}
            trails={props.trails ?? noTrails}
            shownSlots={props.shownSlots ?? noSlots}
            window={props.window ?? null}
          />
        </div>
        <div className="absolute" style={markLayerStyle(camera)}>
          <PlayEffects hits={stage.marks.hits} kos={stage.marks.kos} timeMs={timeMs} />
          {props.stageOverlay ?? <MomentRing moment={props.watched ?? null} timeMs={timeMs} />}
        </div>
        <Players {...props} poses={poses} camera={camera} />
        <LegendsStatus legends={legends} />
        {props.deck}
      </div>
    </StageCameraContext.Provider>
  )
}

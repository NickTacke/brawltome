import type { MatchInsights, Moment, StageBox, StageTrail } from '@brawltome/contracts'
import { type CSSProperties, memo, type ReactNode, useMemo } from 'react'
import { AnimatedPoses } from './AnimatedPoses'
import { backgroundUrlOf } from './background-url'
import { drawnBodiesOf } from './body-ring'
import type { CameraMode } from './camera-mode'
import { KoMarkers } from './KoMarkers'
import { MomentRing } from './MomentRing'
import { PlayEffects } from './PlayEffects'
import { boxInFrame, type Camera, inFrame, StageViewContext } from './play-camera'
import { type Pose, posesAt } from './pose'
import { StageBackdrop, StagePicture, type TimeWindow } from './StagePicture'
import { StageSpinner } from './StageSpinner'
import { cameraNow, cameraPathKey } from './stage-camera'
import { TokenPoses } from './TokenPoses'
import { useCameraBlend } from './use-camera-blend'
import type { Legends } from './use-legends'
import { useMapArt } from './use-map-art'

// the stage is drawn once; only what sits on top of it changes from frame to frame
const StillStage = memo(StagePicture)
const noTrails: StageTrail[] = []
const noSlots: number[] = []
const ignoreBuffering = () => undefined
// the window has the shape of the game's screen on every level. the picture runs to the phone's edges, so its corners
// are square there
const stageWindow = 'relative aspect-video overflow-hidden rounded-lg bg-black/[0.14] phone:rounded-none'

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
  // what lies on the stage over the players: its controls, which place the note on the legends among them
  deck?: (legendsNote: ReactNode) => ReactNode
  // where players stood, drawn into the stage itself: whose, and for which part of the match
  trails?: StageTrail[]
  shownSlots?: number[]
  window?: TimeWindow | null
  // true while the moment on screen waits for its art
  onBuffering?: (isBuffering: boolean) => void
}

// the stage's picture is as wide as the frame and has the stage box's shape, in a layer the size of the frame. the
// layer is moved and scaled as one to where the camera puts the box, which is cheap to do every frame
function pictureStyle(box: StageBox, camera: Camera): CSSProperties {
  const place = boxInFrame(box, camera)

  return { transform: `translate(${place.x * 100}%, ${place.y * 100}%) scale(${place.width})` }
}

// marks on the stage are laid out on a layer that covers the stage box where the camera puts it, so they land where
// the camera puts their spot but keep their own size
function markLayerStyle(box: StageBox, camera: Camera): CSSProperties {
  const place = boxInFrame(box, camera)

  return {
    left: `${place.x * 100}%`,
    top: `${place.y * 100}%`,
    width: `${place.width * 100}%`,
    height: `${place.height * 100}%`,
  }
}

// why the legends aren't drawn: they are still being drawn, or they aren't coming
function LegendsNote({ state }: { state: Legends['state'] }) {
  if (state !== 'drawing' && state !== 'unavailable') return null

  const text = state === 'drawing' ? 'Drawing legends…' : 'Legends unavailable for this match'

  return <span className="rounded-sm bg-ink/80 px-1.5 text-xs leading-5 text-soft">{text}</span>
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
    const framed = poses.map((pose) => inFrame(pose, insights.insights.stage.box, camera))

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
  const art = useMapArt(legends.replay, stage.art)
  const note = <LegendsNote state={legends.state} />
  const bodies = drawnBodiesOf(stage, legends)

  return (
    <StageViewContext.Provider value={{ bodies, camera }}>
      {/* the deck lies on the picture, or under it on a phone, so it is beside the window that crops the picture */}
      <div className="relative">
        <div data-stage-window className={stageWindow}>
          {backgroundUrl ? <StageBackdrop imageUrl={backgroundUrl} /> : null}
          {/* the level, moved by the camera over the fixed background */}
          <div data-stage-picture className="absolute inset-0 origin-top-left" style={pictureStyle(stage.box, camera)}>
            <StillStage
              stage={stage}
              art={art}
              trails={props.trails ?? noTrails}
              shownSlots={props.shownSlots ?? noSlots}
              window={props.window ?? null}
            />
          </div>
          <div data-stage-marks className="absolute" style={markLayerStyle(stage.box, camera)}>
            <PlayEffects hits={stage.marks.hits} bodies={bodies} timeMs={timeMs} />
            {props.stageOverlay ?? <MomentRing moment={props.watched ?? null} bodies={bodies} timeMs={timeMs} />}
          </div>
          <KoMarkers kos={stage.marks.kos} box={stage.box} camera={camera} timeMs={timeMs} />
          <Players {...props} poses={poses} camera={camera} />
          {legends.state === 'loading' && legends.isDownloading ? <StageSpinner label="Loading legends" /> : null}
        </div>
        {props.deck ? props.deck(note) : <div className="absolute top-2 left-2">{note}</div>}
      </div>
    </StageViewContext.Provider>
  )
}

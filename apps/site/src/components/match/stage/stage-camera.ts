import type { Stage } from '@brawltome/contracts'
import { cameraAt } from '@brawltome/replay-player'
import type { CameraMode } from './camera-mode'
import { type Camera, cameraOn, fixedCamera } from './play-camera'
import { stepAt } from './playback-timeline'
import type { Legends } from './use-legends'

// what the camera on the stage follows besides the clock
export type CameraSource = { mode: CameraMode; legends: Legends; stage: Stage }

/**
 * The camera at a time of the clock. Without legends the tokens are drawn on the whole stage. The game's camera needs
 * the legends' art and timeline, so it shows the whole stage until they load. The game's view is shown as it is: it
 * has the frame's shape and lies inside the level's camera bounds already.
 */
export function cameraNow({ mode, legends, stage }: CameraSource, timeMs: number): Camera {
  const wholeStage = fixedCamera(stage.box)

  if (!stage.hasAnimations || mode === 'stage') return wholeStage

  if (legends.state !== 'ready' || !legends.track || !legends.timeline) return wholeStage

  const view = cameraAt(legends.track, stepAt(legends.timeline, timeMs))

  return view ? cameraOn(view) : wholeStage
}

/** What the camera's path depends on besides the clock; when it changes, the view glides onto the new path. */
export function cameraPathKey({ mode, legends }: CameraSource): string {
  if (mode === 'game') return `game ${legends.state}`

  return mode
}

import type { StageBox } from '@brawltome/contracts'
import type { Rect } from '@brawltome/replay-player'
import { createContext, useContext } from 'react'
import type { DrawnBodies } from './body-ring'

// the part of the level playback shows. the frame has the shape of the game's screen on every level: a level's camera
// bounds can be wider or taller than the screen, and the game's camera cuts them to the screen's shape and pans inside
// them. so the camera is the rectangle of the level the frame shows, in level units, and everything on the frame is
// placed from that rectangle and the frame's size

/** Width over height of the playback frame: the game's screen, 1920 by 1080. */
export const frameAspect = 16 / 9

/** The rectangle of the level the frame shows, in level units. It always has the frame's shape. */
export type Camera = Rect

/**
 * The camera that shows a rectangle of the level whole, in the middle of the frame. A rectangle of the frame's shape,
 * as every view of the game's camera is, is shown as it is; around any other, the frame shows that much more of the
 * level on its short side.
 */
export function cameraOn(rect: Rect): Camera {
  const width = Math.max(rect.width, rect.height * frameAspect)
  const height = width / frameAspect

  return { x: rect.x - (width - rect.width) / 2, y: rect.y - (height - rect.height) / 2, width, height }
}

/**
 * The fixed camera: the whole stage box, which is the level's camera bounds, in the middle of the frame. Where the
 * bounds don't have the frame's shape, the frame shows the level a little past them on the short side. The game's
 * first window would cut them to the frame's shape instead, and lose the bottom of a tall level or the sides of a
 * wide one, which the fixed camera is there to keep in view.
 */
export function fixedCamera(box: StageBox): Camera {
  return cameraOn({ x: box.minX, y: box.minY, width: box.width, height: box.height })
}

/** Where the stage box lies in the frame under a camera, in shares of the frame. */
export function boxInFrame(box: StageBox, camera: Camera): Rect {
  return {
    x: (box.minX - camera.x) / camera.width,
    y: (box.minY - camera.y) / camera.height,
    width: box.width / camera.width,
    height: box.height / camera.height,
  }
}

/** Where a spot on the stage, in shares of the stage box, lands in the frame under a camera, in shares of the frame. */
export function inFrame<Spot extends { x: number; y: number }>(spot: Spot, box: StageBox, camera: Camera): Spot {
  const place = boxInFrame(box, camera)

  return { ...spot, x: place.x + spot.x * place.width, y: place.y + spot.y * place.height }
}

/** How wide a level unit is in the frame under a camera, as a share of the frame's width. */
export function unitInFrame(camera: Camera): number {
  return 1 / camera.width
}

// how the frame shows the stage: how its players are drawn, in which level coordinates, and where the camera looks
export type StageView = { bodies: DrawnBodies; camera: Camera }

const noBox: StageBox = { minX: 0, minY: 0, width: frameAspect, height: 1 }

const noStage: StageView = { bodies: { box: noBox, areLegends: false }, camera: fixedCamera(noBox) }

// what sits on the stage outside its picture, like the card of a review stop, reads how the stage is shown from here
export const StageViewContext = createContext<StageView>(noStage)

export function useStageView(): StageView {
  return useContext(StageViewContext)
}

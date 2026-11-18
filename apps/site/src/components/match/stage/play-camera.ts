import type { StageBox } from '@brawltome/contracts'
import type { Matrix, Rect } from '@brawltome/replay-player'
import { createContext, useContext } from 'react'

// the part of the stage playback shows. with the legends drawn, it is the game's own camera, worked out from the
// timeline by the replay player; without them, the whole stage. everything here is in shares of the stage box, which
// has the frame's aspect, so a square in shares fills the frame

/** The part of the stage in view: its top left corner and how many times the whole stage is enlarged. */
export type Camera = { x: number; y: number; zoom: number }

export const wholeStage: Camera = { x: 0, y: 0, zoom: 1 }

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * The camera that shows a rectangle of the level, fitted and centred as the game fits its view to the screen. The
 * frame never shows past the stage box: the game keeps its view inside the level's camera bounds, which the box is.
 */
export function cameraOf(rect: Rect, box: StageBox): Camera {
  const width = rect.width / box.width
  const height = rect.height / box.height
  const zoom = Math.max(1, Math.min(1 / width, 1 / height))
  const shown = 1 / zoom
  const middleX = (rect.x - box.minX) / box.width + width / 2
  const middleY = (rect.y - box.minY) / box.height + height / 2

  return {
    x: clamp(middleX - shown / 2, 0, 1 - shown),
    y: clamp(middleY - shown / 2, 0, 1 - shown),
    zoom,
  }
}

/** The matrix taking level units to the pixels of a canvas that covers the frame. */
export function levelToCanvas(box: StageBox, camera: Camera, width: number, height: number): Matrix {
  const scaleX = (width * camera.zoom) / box.width
  const scaleY = (height * camera.zoom) / box.height
  const offsetX = -(box.minX / box.width + camera.x) * camera.zoom * width
  const offsetY = -(box.minY / box.height + camera.y) * camera.zoom * height

  return [scaleX, 0, 0, scaleY, offsetX, offsetY]
}

/** The rectangle of the level a camera shows in the frame, in level units. */
export function viewOf(box: StageBox, camera: Camera): Rect {
  return {
    x: box.minX + camera.x * box.width,
    y: box.minY + camera.y * box.height,
    width: box.width / camera.zoom,
    height: box.height / camera.zoom,
  }
}

/** Where a spot on the stage lands in the frame, as shares of the frame, under a camera. */
export function inFrame<Spot extends { x: number; y: number }>(spot: Spot, camera: Camera): Spot {
  return { ...spot, x: (spot.x - camera.x) * camera.zoom, y: (spot.y - camera.y) * camera.zoom }
}

// what sits on the stage outside its picture, like the card of a review stop, reads where the camera looks from here
export const StageCameraContext = createContext<Camera>(wholeStage)

export function useStageCamera(): Camera {
  return useContext(StageCameraContext)
}

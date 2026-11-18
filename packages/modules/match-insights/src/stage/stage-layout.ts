import type { LevelLayout, StageArt, StageBox, StageRect, StageSegment } from '@brawltome/contracts'
import { toShare } from './stage-box'

// a map's level layout drawn in the stage box

type Bounds = { x: number; y: number; width: number; height: number }

export function cameraBox(layout: LevelLayout): StageBox {
  const { camera } = layout

  return { minX: camera.x, minY: camera.y, width: camera.width, height: camera.height }
}

export function rectOf(box: StageBox, bounds: Bounds): StageRect {
  return {
    x: (bounds.x - box.minX) / box.width,
    y: (bounds.y - box.minY) / box.height,
    width: bounds.width / box.width,
    height: bounds.height / box.height,
  }
}

export function layoutSegments(box: StageBox, layout: LevelLayout): StageSegment[] {
  return layout.collisions.map((line) => {
    const [fromX, fromY] = toShare(box, { x: line.fromX, y: line.fromY })
    const [toX, toY] = toShare(box, { x: line.toX, y: line.toY })

    return { fromX, fromY, toX, toY, isSoft: line.isSoft }
  })
}

export function layoutArt(box: StageBox, layout: LevelLayout): StageArt[] {
  return layout.art.map((piece) => ({ file: piece.file, rotation: piece.rotation, ...rectOf(box, piece) }))
}

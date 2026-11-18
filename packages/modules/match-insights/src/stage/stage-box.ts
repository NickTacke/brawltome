import type { StageBox } from '@brawltome/contracts'
import type { Position } from '../positions'

// the box in level units a stage is drawn in: the game's camera when the map's layout is known, otherwise the area
// players stood in, padded and widened to the shape of the game's backgrounds

const tracedAspect = 16 / 9
const paddingShare = 0.08
// players flung far off the stage would shrink it to a corner of the box, so the outermost samples are left out
const trimmedShare = 0.02

function trimmedRange(values: number[]): { low: number; high: number } {
  const sorted = [...values].sort((left, right) => left - right)
  const at = (share: number) => sorted[Math.floor((sorted.length - 1) * share)] ?? 0

  return { low: at(trimmedShare), high: at(1 - trimmedShare) }
}

export function tracedBox(samples: Position[]): StageBox {
  const across = trimmedRange(samples.map((sample) => sample.x))
  const down = trimmedRange(samples.map((sample) => sample.y))
  const rawWidth = across.high - across.low || 1
  const rawHeight = down.high - down.low || 1
  const height = Math.max(rawHeight, rawWidth / tracedAspect) * (1 + paddingShare * 2)
  const width = height * tracedAspect

  return {
    minX: (across.high + across.low) / 2 - width / 2,
    minY: (down.high + down.low) / 2 - height / 2,
    width,
    height,
  }
}

// a share to three decimals is a pixel at a thousand pixels wide
function roundShare(share: number): number {
  return Math.round(share * 1000) / 1000
}

/** Where a spot sits in the box, as shares; a spot outside it, like a KO at the blast line, sits on its edge. */
export function toShare(box: StageBox, spot: Position): [number, number] {
  const clamp = (share: number) => roundShare(Math.min(Math.max(share, 0), 1))

  return [clamp((spot.x - box.minX) / box.width), clamp((spot.y - box.minY) / box.height)]
}

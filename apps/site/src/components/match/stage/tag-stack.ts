import type { Pose } from './pose'

// keeps the tags over players apart when the players stand on the same spot

// a tag with its three stock dots, and a little air around it
export const tagHeightPx = 20
export const tagWidthPx = 68
// how far above the feet the tag sits, in level units: just over a standing legend's head
export const tagLift = 190

type Frame = { width: number; height: number }
type PlacedTag = { x: number; y: number }

function isTaken(placed: PlacedTag[], x: number, y: number): boolean {
  return placed.some((tag) => Math.abs(tag.x - x) < tagWidthPx && Math.abs(tag.y - y) < tagHeightPx)
}

// the lowest level over the player that no tag placed before lies on. there is always one: each tag placed before
// takes at most two levels, so the search ends within two levels per tag
function freeLift(placed: PlacedTag[], x: number, y: number): number {
  let lift = 0

  while (isTaken(placed, x, y - lift * tagHeightPx)) lift += 1

  return lift
}

/**
 * How many tag heights each player's tag is lifted, by slot, so no two tags lie on each other. Players are taken in
 * the order of their slots, so a tag keeps its level from frame to frame while the same players stand together.
 */
export function tagLifts(poses: Pose[], frame: Frame | null): Map<number, number> {
  const lifts = new Map<number, number>()

  if (!frame) return lifts

  const placed: PlacedTag[] = []

  for (const pose of [...poses].sort((left, right) => left.slot - right.slot)) {
    const x = pose.x * frame.width
    const y = pose.y * frame.height
    const lift = freeLift(placed, x, y)

    placed.push({ x, y: y - lift * tagHeightPx })
    lifts.set(pose.slot, lift)
  }

  return lifts
}

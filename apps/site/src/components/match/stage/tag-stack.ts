import type { Pose } from './pose'

// keeps the tags over players apart when the players stand on the same spot

// a tag with its three stock dots, and a little air around it
export const tagHeightPx = 20
export const tagWidthPx = 68
// how far above the feet the tag sits, in level units: just over a standing legend's head
export const tagLift = 190
// a portrait token is 36 pixels high on every stage, with its 2 pixel ring; a tag over one sits on the ring
export const portraitTagLiftPx = 38

type Frame = { width: number; height: number }
type PlacedTag = { x: number; y: number }

// how far above the feet a portrait's tag sits, in shares of the frame. a portrait is as big on every stage, so where
// the camera is far out it stands taller than a legend's head, and its tag goes over it
function portraitRaise(legendRaise: number, frame: Frame | null): number {
  if (!frame) return legendRaise

  return Math.max(legendRaise, portraitTagLiftPx / frame.height)
}

function raisedBy(pose: Pose, raise: number): Pose {
  return { ...pose, y: pose.y - raise }
}

/**
 * Where the foot of each player's tag sits, in shares of the frame, from their poses in the frame: `legendRaise` over
 * a legend's feet, and over the portrait of a player drawn as one.
 */
export function tagFeet(legends: Pose[], portraits: Pose[], legendRaise: number, frame: Frame | null): Pose[] {
  const overPortraits = portraitRaise(legendRaise, frame)

  return [
    ...legends.map((pose) => raisedBy(pose, legendRaise)),
    ...portraits.map((pose) => raisedBy(pose, overPortraits)),
  ]
}

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
 * How many tag heights each player's tag is lifted from its foot, by slot, so no two tags lie on each other. Players
 * are taken in the order of their slots, so a tag keeps its level from frame to frame while the same players stand
 * together.
 */
export function tagLifts(tags: Pose[], frame: Frame | null): Map<number, number> {
  const lifts = new Map<number, number>()

  if (!frame) return lifts

  const placed: PlacedTag[] = []

  for (const pose of [...tags].sort((left, right) => left.slot - right.slot)) {
    const x = pose.x * frame.width
    const y = pose.y * frame.height
    const lift = freeLift(placed, x, y)

    placed.push({ x, y: y - lift * tagHeightPx })
    lifts.set(pose.slot, lift)
  }

  return lifts
}

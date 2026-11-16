import type { Pose } from './pose'

// keeps the tags over players apart when the players stand on the same spot

// a tag with its three stock dots, and a little air around it
export const tagHeightPx = 20
const tagWidthPx = 68
const highestLift = 3

type Frame = { width: number; height: number }

/**
 * How many tag heights each player's tag is lifted, by slot, so no two tags lie on each other. Players are taken in
 * the order of their slots, so a tag keeps its level from frame to frame while the same players stand together.
 */
export function tagLifts(poses: Pose[], frame: Frame | null): Map<number, number> {
  const lifts = new Map<number, number>()

  if (!frame) return lifts

  const placed: { x: number; y: number }[] = []

  const isTaken = (x: number, y: number) =>
    placed.some((tag) => Math.abs(tag.x - x) < tagWidthPx && Math.abs(tag.y - y) < tagHeightPx)

  for (const pose of [...poses].sort((left, right) => left.slot - right.slot)) {
    const x = pose.x * frame.width
    let lift = 0

    while (lift < highestLift && isTaken(x, pose.y * frame.height - lift * tagHeightPx)) lift += 1

    placed.push({ x, y: pose.y * frame.height - lift * tagHeightPx })
    lifts.set(pose.slot, lift)
  }

  return lifts
}

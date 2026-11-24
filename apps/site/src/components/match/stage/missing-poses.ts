import type { StageBox } from '@brawltome/contracts'
import type { Timeline } from '@brawltome/replay-player'
import { bubblesBySlot } from './offscreen-bubbles'
import { type Camera, inFrame } from './play-camera'
import { stepAt } from './playback-timeline'
import type { Pose } from './pose'

// a player whose art can't load is drawn as their portrait where the game would draw their legend: on their own spot
// while they are in view, and in their bubble at the frame's edge while they are out of it

/** The poses of the players whose art can't load, in shares of the frame, where their legends would be drawn. */
export function missingPosesInFrame(
  poses: Pose[],
  missingSlots: ReadonlySet<number>,
  timeline: Timeline,
  box: StageBox,
  camera: Camera,
  timeMs: number,
): Pose[] {
  const missing = poses.filter((pose) => missingSlots.has(pose.slot))

  if (missing.length === 0) return missing

  const bubbles = bubblesBySlot(timeline, camera, stepAt(timeline, timeMs))

  return missing.map((pose) => {
    const bubble = bubbles.get(String(pose.slot))

    if (!bubble) return inFrame(pose, box, camera)

    // the bubble's spot is in level units, like the camera
    const x = (bubble.player.x - camera.x) / camera.width
    const y = (bubble.player.y - camera.y) / camera.height

    return { ...pose, x, y }
  })
}

import type { StageBox } from '@brawltome/contracts'
import { slotColour } from '../match-styles'
import { type Camera, inFrame } from './play-camera'
import type { Pose } from './pose'
import { isOnScreen, PoseTag } from './TokenPoses'
import { tagHeightPx, tagLift, tagLifts } from './tag-stack'

type LegendTagsProps = {
  poses: Pose[]
  selectedSlot: number
  box: StageBox
  camera: Camera
  // the frame as laid out, once it is; tags that would lie on each other are told apart in its pixels
  frame: { width: number; height: number } | null
}

/** The weapon, damage and stocks of each player on screen, above their legend's head. */
export function LegendTags({ poses, selectedSlot, box, camera, frame }: LegendTagsProps) {
  const tagShare = tagLift / camera.height
  const shown = poses.map((pose) => inFrame(pose, box, camera)).filter(isOnScreen)
  // players on the same spot get their tags one over the other
  const lifts = tagLifts(shown, frame)

  return shown.map((pose) => (
    <div
      key={pose.slot}
      className="pointer-events-none absolute z-[1] flex -translate-x-1/2 -translate-y-full flex-col items-center"
      style={{
        left: `${pose.x * 100}%`,
        top: `${(pose.y - tagShare) * 100}%`,
        marginTop: -(lifts.get(pose.slot) ?? 0) * tagHeightPx,
      }}
    >
      <PoseTag pose={pose} />
      <span
        className="h-0.5 w-6 rounded-full"
        style={{ backgroundColor: slotColour(pose.slot), opacity: pose.slot === selectedSlot ? 1 : 0.6 }}
      />
    </div>
  ))
}

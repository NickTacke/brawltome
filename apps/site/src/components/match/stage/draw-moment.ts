import {
  drawObject,
  drawPlayer,
  type Matrix,
  objectsAt,
  poseAt,
  type Rect,
  type Replay,
  type Timeline,
} from '@brawltome/replay-player'
import { bubblesBySlot, drawBubbles, intoBubble } from './offscreen-bubbles'

// while a frame can't be drawn whole, the last one that could stays on screen, unless the clock has jumped away from it
const heldFrameSteps = 30

// what drawing a moment reads: the match's art and its timeline
export type DrawnMatch = { replay: Replay; timeline: Timeline }

// how the frame shows the level: the matrix to the canvas's pixels, and the part of the level in view
export type Framing = { transform: Matrix; view: Rect }

/**
 * Draws the players and objects at a step, objects marked as behind under the players and the rest over them, then
 * the bubbles of the players out of view, who are drawn in them. Each is drawn whole or not at all; false when one
 * couldn't be, as its art hasn't loaded yet.
 */
function drawStep(context: CanvasRenderingContext2D, match: DrawnMatch, step: number, framing: Framing): boolean {
  const { replay, timeline } = match
  const { transform } = framing
  const objectFrames = (index: number) => replay.objects?.animations.frameCount(index) ?? 0
  const objects = replay.objects ? objectsAt(timeline, step, objectFrames) : []
  const bubbles = bubblesBySlot(timeline, framing.view, step)
  let isWhole = true

  for (const object of objects) {
    if (object.behind) isWhole = drawObject(context, replay, object, transform) && isWhole
  }

  for (const [slot, player] of replay.players) {
    const pose = poseAt(timeline, slot, step, (index) => player.animations.frameCount(index))

    if (pose) isWhole = drawPlayer(context, replay, player, intoBubble(pose, bubbles.get(slot)), transform) && isWhole
  }

  for (const object of objects) {
    if (!object.behind) isWhole = drawObject(context, replay, object, transform) && isWhole
  }

  return drawBubbles(context, replay, bubbles.values(), transform) && isWhole
}

/**
 * Draws one moment of playback; false when it couldn't be drawn whole. The last whole frame then stays on screen while
 * the art loads, so a legend never blinks out; after a jump there is no such frame, and what could be drawn shows.
 */
export function drawMoment(
  canvas: HTMLCanvasElement,
  match: DrawnMatch,
  step: number,
  framing: Framing,
  lastWholeStep: number | null,
): boolean {
  const context = canvas.getContext('2d')

  if (!context) return true

  context.clearRect(0, 0, canvas.width, canvas.height)

  const isWhole = drawStep(context, match, step, framing)

  if (isWhole || lastWholeStep === null || Math.abs(lastWholeStep - step) > heldFrameSteps) return isWhole

  context.clearRect(0, 0, canvas.width, canvas.height)
  drawStep(context, match, lastWholeStep, framing)

  return false
}

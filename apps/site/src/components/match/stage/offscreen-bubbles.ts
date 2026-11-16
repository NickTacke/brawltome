import {
  type Bubble,
  bubbleMatrix,
  bubblesAt,
  drawObject,
  type Matrix,
  type ObjectPose,
  offscreenPlayersAt,
  type PlayerPose,
  type Rect,
  type Replay,
  type Timeline,
} from '@brawltome/replay-player'

// the bubble the game draws at the edge of the screen for a player out of view. the game doesn't draw a second view
// of the player: it moves the player's own sprite into the bubble, at the world's scale, and draws the bubble's art
// over it

/** The bubbles the game draws over a view of the level at a step, by slot. */
export function bubblesBySlot(timeline: Timeline, view: Rect, step: number): Map<string, Bubble> {
  const bubbles = bubblesAt(view, offscreenPlayersAt(timeline, step))

  return new Map(bubbles.map((bubble) => [bubble.slot, bubble]))
}

/** A player's pose where the game draws it: in their bubble when they have one. */
export function intoBubble(pose: PlayerPose, bubble: Bubble | undefined): PlayerPose {
  if (!bubble) return pose

  return { ...pose, x: bubble.player.x, y: bubble.player.y }
}

/** The bubble's art as one of the objects, with no look; its animation comes after the timeline's own objects'. */
export function bubblePose(bubble: Bubble, animationIndex: number): ObjectPose {
  return {
    index: -1,
    animationIndex,
    look: '-',
    frame: 0,
    matrix: bubbleMatrix(bubble),
    alpha: bubble.alpha,
    behind: false,
    owner: null,
  }
}

/**
 * Draws the bubbles' art, in the players' order, over everything else as the game's UI layer is. An export made
 * before the art was in it draws none. False while the art hasn't loaded.
 */
export function drawBubbles(
  context: CanvasRenderingContext2D,
  replay: Replay,
  bubbles: Iterable<Bubble>,
  levelToCanvas: Matrix,
): boolean {
  const animationIndex = replay.manifest.offscreenBubble

  if (animationIndex === undefined) return true

  let isWhole = true

  for (const bubble of bubbles) {
    isWhole = drawObject(context, replay, bubblePose(bubble, animationIndex), levelToCanvas) && isWhole
  }

  return isWhole
}

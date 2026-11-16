// The bubble the game draws at the edge of the screen for a player out of the camera's view, worked out from a replay
// line. No Node APIs. The README's "Off screen" lists each rule with where it is in the game's code: Entity's `_-Y3P`
// in 11.00, as `bhnative dump --code` prints it, which runs once a step for each player after they move.
//
// The game doesn't draw a second, smaller view of the player: it moves the player's own sprite to the bubble, at the
// world's scale, and draws the bubble's art over it (the art's middle is white at 40 %). So a player in a bubble keeps
// their weapon and tint, while objects (thrown weapons, effects) stay where they are, out of view.

import type { Rect } from './format.ts'
import type { Timeline } from './timeline.ts'
import { positionAt } from './timeline.ts'

export const OFFSCREEN = {
  // the bubble's middle sits this far inside the view's edge, on each side the player is past (0x0181, 0x01c3,
  // 0x0246, 0x028e)
  inset: 210,
  // the bubble is centred on the player's body: half the HeroType's Height (`_-pe`, 160 for every legend) above the
  // feet (0x036c-0x0380)
  bodyMiddle: 80,
  // the art's circle, in level units: the symbol is drawn at scale 1 in the world's layer (worldUILayer3D)
  radius: 165,
  // after a KO the bubble fades out over this long, from the KO's time (`_-7G`, set by Entity's `_-Q2q`), and slides
  // outwards three insets by the time it's gone (0x067c-0x0879)
  fadeMs: 146,
  slide: 210 * 3,
  // the art: Entity's `_-93c` makes it from this SWF symbol, at its "Ready" label
  art: { file: 'SFX_KO.swf', symbol: 'a_OffScreenBubble', animation: 'Ready' },
} as const

// the sides a player is past, as the game's bits
const TOP = 1
const BOTTOM = 2
const LEFT = 4
const RIGHT = 8

// the arrow's angle for each side or corner, in degrees, clockwise from pointing right (0x05b2-0x065d): it points at
// the side the player left by, in eight steps, not at the player
const ANGLES = new Map([
  [RIGHT, 0],
  [RIGHT | BOTTOM, 45],
  [BOTTOM, 90],
  [BOTTOM | LEFT, 135],
  [LEFT, 180],
  [LEFT | TOP, 225],
  [TOP, 270],
  [TOP | RIGHT, 315],
])

// OffscreenPlayer is what the bubble reads of a player at a step
export type OffscreenPlayer = {
  slot: string
  // the player's feet, in level units
  x: number
  y: number
  // in play: the game's status 0 or 5 (the line's "live")
  isLive: boolean
  // the time since the player was knocked out, while that's the last thing that happened to them
  msSinceKo?: number
}

// Bubble is one bubble the game draws at a step
export type Bubble = {
  slot: string
  // the bubble's middle, in level units
  x: number
  y: number
  radius: number
  // the arrow's angle, in degrees, clockwise from pointing right
  angle: number
  alpha: number
  // where the game draws the player instead of where they are: their feet, in level units
  player: { x: number; y: number }
  // the player's scale in the bubble: the world's own
  zoom: number
}

// sidesOf is the sides of the view a point is past, as the game's bits; a point on the edge is still in view
function sidesOf(view: Rect, x: number, y: number): number {
  let sides = 0

  if (x < view.x) sides |= LEFT
  else if (x > view.x + view.width) sides |= RIGHT

  if (y < view.y) sides |= TOP
  else if (y > view.y + view.height) sides |= BOTTOM

  return sides
}

// fadeOf is how far through the KO's fade the bubble is, 0 to 1, or undefined while it isn't fading
function fadeOf(player: OffscreenPlayer): number | undefined {
  const ms = player.msSinceKo

  if (ms === undefined || ms < 0 || ms >= OFFSCREEN.fadeMs) return undefined

  return ms / OFFSCREEN.fadeMs
}

// feetXOf is where the game holds a player's feet sideways: the inset inside the side they're past, or where they are
function feetXOf(view: Rect, sides: number, x: number): number {
  if (sides & LEFT) return view.x + OFFSCREEN.inset

  if (sides & RIGHT) return view.x + view.width - OFFSCREEN.inset

  return x
}

// middleYOf is where the game holds the middle of a player's body up or down, as feetXOf does sideways
function middleYOf(view: Rect, sides: number, feetY: number): number {
  if (sides & TOP) return view.y + OFFSCREEN.inset

  if (sides & BOTTOM) return view.y + view.height - OFFSCREEN.inset

  return feetY - OFFSCREEN.bodyMiddle
}

// outwards is a distance along one axis, signed to go out through the side past, or 0 when neither side is
function outwards(sides: number, low: number, high: number, distance: number): number {
  if (sides & low) return -distance

  if (sides & high) return distance

  return 0
}

// bubbleOf is a player's bubble, or undefined when the game draws none for them
function bubbleOf(view: Rect, player: OffscreenPlayer): Bubble | undefined {
  const fade = fadeOf(player)

  if (!player.isLive && fade === undefined) return undefined

  const sides = sidesOf(view, player.x, player.y)

  if (sides === 0) return undefined

  const feetX = feetXOf(view, sides, player.x)
  const middleY = middleYOf(view, sides, player.y)

  // a fading bubble slides out through the sides it's past, the same distance on each
  const faded = fade ?? 0
  const slide = faded * OFFSCREEN.slide

  return {
    slot: player.slot,
    x: feetX + outwards(sides, LEFT, RIGHT, slide),
    y: middleY + outwards(sides, TOP, BOTTOM, slide),
    radius: OFFSCREEN.radius,
    angle: ANGLES.get(sides) ?? 0,
    alpha: 1 - faded,
    player: { x: feetX, y: middleY + OFFSCREEN.bodyMiddle },
    zoom: 1,
  }
}

// bubblesAt is the bubbles the game draws over a view (a rectangle of the level, as src/camera.ts gives it), one per
// player out of it, in the players' order: the order the game draws them in, each over the players. Two bubbles at
// the same side or corner overlap; the game doesn't move one aside
export function bubblesAt(view: Rect, players: OffscreenPlayer[]): Bubble[] {
  if (view.width <= 0 || view.height <= 0) return []

  return players.flatMap((player) => bubbleOf(view, player) ?? [])
}

// koStepAt is the step of a player's last KO at or before a step, while nothing has happened to them since: the step
// their status went from in play ("live" or "held") to "ko", or to "eliminated" for their last stock
function koStepAt(status: [number, string][], step: number): number | undefined {
  let last: number | undefined

  for (let i = 1; i < status.length && status[i][0] <= step; i++) {
    const [from, name] = status[i]
    const wasInPlay = status[i - 1][1] === 'live' || status[i - 1][1] === 'held'

    last = wasInPlay && (name === 'ko' || name === 'eliminated') ? from : undefined
  }

  return last
}

// statusAt is a player's status at a step
function statusAt(status: [number, string][], step: number): string | undefined {
  let found: string | undefined

  for (const [from, name] of status) {
    if (from > step) break

    found = name
  }

  return found
}

// offscreenPlayersAt is what bubblesAt reads of each player at a step of a line (fractional between steps: the
// position follows, the status and the fade go by the step before)
export function offscreenPlayersAt(timeline: Timeline, step: number): OffscreenPlayer[] {
  const whole = Math.floor(step)
  const stepMs = timeline.stepMs ?? 16

  return Object.entries(timeline.state).flatMap(([slot, state]) => {
    const position = positionAt(timeline, slot, step)

    if (!position) return []

    const status = state.status ?? []
    const koStep = koStepAt(status, whole)
    const msSinceKo = koStep === undefined ? undefined : (whole - koStep) * stepMs

    return [{ slot, x: position.x, y: position.y, isLive: statusAt(status, whole) === 'live', msSinceKo }]
  })
}

// bubbleMatrix takes the bubble's art (its own units, which are level units) to level units: turned to the arrow's
// angle about its middle
export function bubbleMatrix(bubble: Bubble): [number, number, number, number, number, number] {
  const radians = (bubble.angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return [cos, sin, -sin, cos, bubble.x, bubble.y]
}

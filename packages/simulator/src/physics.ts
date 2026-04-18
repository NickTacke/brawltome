// First-pass platformer physics. Enough to move entities around and produce
// non-trivial posture totals; the constants are plausible placeholders, not
// a port of Brawlhalla's engine. Tuning happens when we have a regression
// target to aim at.

import type { CollisionLine, LevelGeometry } from '@brawltome/game-data'
import { InputFlag } from '@brawltome/replay-format'
import { TICK_MS } from './tick'
import type { EntityState, PhysicsParams, Vec2 } from './types'

// Default physics params in the same coord space as Brawlhalla (units ~ pixels
// at 1x scale, y-down). Picked to feel roughly right, not frame-accurate.
export const DEFAULT_PHYSICS: PhysicsParams = {
  walkSpeed: 700,
  jumpImpulse: 1200,
  gravity: 3500,
  maxFallSpeed: 1800,
}

const TICK_S = TICK_MS / 1000
const EPSILON = 0.5

// Default jump budget: 3 total, shared between ground + air. A grounded
// player can do 1 ground + 2 air; a player who walks off a ledge without
// jumping still has 3 air jumps left. Landing on any surface refills to 3.
//
// Recoveries (the Jump-while-held-Up special arc, and the "exhausted
// recovery" that consumes a jump slot once the normal recovery is spent)
// are a separate mechanic and not modelled here.
export const DEFAULT_MAX_JUMPS = 3

// Active physics state that spans the tick loop. Tracks the previous-tick
// input bitmask so we can detect edge-triggered actions (Jump press, etc.),
// and the remaining mid-air jumps before needing to touch ground again.
export type EntityPhysState = {
  prevFlags: number
  jumpsRemaining: number
}

export function makePhysState(): EntityPhysState {
  return { prevFlags: 0, jumpsRemaining: DEFAULT_MAX_JUMPS }
}

const isHorizontal = (c: CollisionLine): boolean => c.y1 === c.y2
const isVertical = (c: CollisionLine): boolean => c.x1 === c.x2

// Finds the topmost horizontal surface under `pos` within `maxDrop`. Hard /
// no_slide lines are always solid from both sides; soft platforms are solid
// only when we're approaching from above (oldY above the line) and not
// holding drop-through.
function groundBeneath(
  pos: Vec2,
  oldY: number,
  level: LevelGeometry,
  maxDrop: number,
  dropThrough: boolean,
): number | null {
  let best: number | null = null
  for (const c of level.collisions) {
    if (!isHorizontal(c)) continue
    if (pos.x < Math.min(c.x1, c.x2) || pos.x > Math.max(c.x1, c.x2)) continue
    const dy = c.y1 - pos.y
    if (dy < -EPSILON || dy > maxDrop) continue
    const isSoft = c.kind === 'soft' || c.kind === 'bouncy_no_slide'
    if (isSoft) {
      if (dropThrough) continue
      // Require the previous-tick position to be above the line (standing up
      // through a soft platform shouldn't snap us to the top).
      if (oldY > c.y1 + EPSILON) continue
    } else if (c.kind !== 'hard' && c.kind !== 'no_slide' && c.kind !== 'bouncy_hard') {
      continue
    }
    if (best === null || c.y1 < best) best = c.y1
  }
  return best
}

// Returns the nearest vertical hard line that a horizontal move from x0 to x1
// at height y crosses, or null if the path is clear.
function wallCrossed(y: number, x0: number, x1: number, level: LevelGeometry): number | null {
  if (x0 === x1) return null
  const dir = x1 > x0 ? 1 : -1
  const loX = Math.min(x0, x1)
  const hiX = Math.max(x0, x1)
  let best: number | null = null
  for (const c of level.collisions) {
    if (c.kind !== 'hard') continue
    if (!isVertical(c)) continue
    if (y < Math.min(c.y1, c.y2) || y > Math.max(c.y1, c.y2)) continue
    if (c.x1 < loX - EPSILON || c.x1 > hiX + EPSILON) continue
    // Must be strictly in the path, not at the starting edge.
    if (Math.abs(c.x1 - x0) < EPSILON) continue
    if (best === null || (c.x1 - x0) * dir < (best - x0) * dir) best = c.x1
  }
  return best
}

// One tick of movement for one entity. Mutates `entity` in place and returns
// the new prevFlags so the caller can thread state across ticks.
export function stepEntity(
  entity: EntityState,
  flags: number,
  phys: EntityPhysState,
  level: LevelGeometry,
  params: PhysicsParams = DEFAULT_PHYSICS,
): EntityPhysState {
  // Horizontal input -> desired velocity. Immediate on the ground, slower
  // acceleration in the air (approximated here as zero air control).
  const leftHeld = (flags & InputFlag.MoveLeft) !== 0
  const rightHeld = (flags & InputFlag.MoveRight) !== 0
  if (entity.posture === 'ground') {
    if (leftHeld && !rightHeld) {
      entity.vel.x = -params.walkSpeed
      entity.facing = -1
    } else if (rightHeld && !leftHeld) {
      entity.vel.x = params.walkSpeed
      entity.facing = 1
    } else {
      entity.vel.x = 0
    }
  } else {
    // Air: allow direction change but keep speed constant.
    if (leftHeld && !rightHeld) entity.facing = -1
    else if (rightHeld && !leftHeld) entity.facing = 1
  }

  // Jump: edge-triggered. Ground and air jumps draw from the same budget.
  // Walking off a ledge doesn't consume one (posture flips to air without
  // a Jump press).
  const jumpNow = (flags & InputFlag.Jump) !== 0
  const jumpPrev = (phys.prevFlags & InputFlag.Jump) !== 0
  let jumpsRemaining = phys.jumpsRemaining
  if (jumpNow && !jumpPrev && jumpsRemaining > 0) {
    entity.vel.y = -params.jumpImpulse
    entity.posture = 'air'
    jumpsRemaining -= 1
  }

  // Gravity when airborne.
  if (entity.posture !== 'ground') {
    entity.vel.y = Math.min(entity.vel.y + params.gravity * TICK_S, params.maxFallSpeed)
  }

  // Swept horizontal move + wall clamp.
  const startX = entity.pos.x
  const targetX = startX + entity.vel.x * TICK_S
  const wallX = wallCrossed(entity.pos.y, startX, targetX, level)
  if (wallX !== null) {
    const dir = targetX > startX ? 1 : -1
    entity.pos.x = wallX - dir * EPSILON
    entity.vel.x = 0
  } else {
    entity.pos.x = targetX
  }

  // Vertical integration + ground snap. Drop-through lets the entity phase
  // through soft platforms this tick.
  const startY = entity.pos.y
  const dropThrough = (flags & InputFlag.Drop) !== 0
  entity.pos.y += entity.vel.y * TICK_S
  if (entity.vel.y >= 0) {
    const floorY = groundBeneath(entity.pos, startY, level, Math.max(8, entity.vel.y * TICK_S + 2), dropThrough)
    if (floorY !== null) {
      entity.pos.y = floorY
      entity.vel.y = 0
      entity.posture = 'ground'
      jumpsRemaining = DEFAULT_MAX_JUMPS // landing on any surface refills
    } else {
      entity.posture = 'air'
    }
  } else {
    entity.posture = 'air'
  }

  // If we hit a wall while grounded, posture stays 'ground'; if airborne, mark wall.
  if (wallX !== null && entity.posture !== 'ground') entity.posture = 'wall'

  return { prevFlags: flags, jumpsRemaining }
}

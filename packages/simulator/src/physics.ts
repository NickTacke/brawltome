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

// Active physics state that spans the tick loop. Tracks the previous-tick
// input bitmask so we can detect edge-triggered actions (Jump press, etc.).
export type EntityPhysState = {
  prevFlags: number
}

export function makePhysState(): EntityPhysState {
  return { prevFlags: 0 }
}

const isHorizontal = (c: CollisionLine): boolean => c.y1 === c.y2
const isVertical = (c: CollisionLine): boolean => c.x1 === c.x2

// Finds the topmost horizontal hard surface directly under the point, within
// `maxDrop` units. Returns its Y, or null if there's nothing to land on.
function groundBeneath(pos: Vec2, level: LevelGeometry, maxDrop: number): number | null {
  let best: number | null = null
  for (const c of level.collisions) {
    if (c.kind !== 'hard' && c.kind !== 'no_slide') continue
    if (!isHorizontal(c)) continue
    if (pos.x < Math.min(c.x1, c.x2) || pos.x > Math.max(c.x1, c.x2)) continue
    const dy = c.y1 - pos.y
    if (dy < -EPSILON || dy > maxDrop) continue
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

  // Jump: edge-triggered, only from the ground.
  const jumpNow = (flags & InputFlag.Jump) !== 0
  const jumpPrev = (phys.prevFlags & InputFlag.Jump) !== 0
  if (jumpNow && !jumpPrev && entity.posture === 'ground') {
    entity.vel.y = -params.jumpImpulse
    entity.posture = 'air'
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

  // Vertical integration + ground snap.
  entity.pos.y += entity.vel.y * TICK_S
  if (entity.vel.y >= 0) {
    const floorY = groundBeneath(entity.pos, level, Math.max(8, entity.vel.y * TICK_S + 2))
    if (floorY !== null) {
      entity.pos.y = floorY
      entity.vel.y = 0
      entity.posture = 'ground'
    } else {
      entity.posture = 'air'
    }
  } else {
    entity.posture = 'air'
  }

  // If we hit a wall while grounded, posture stays 'ground'; if airborne, mark wall.
  if (wallX !== null && entity.posture !== 'ground') entity.posture = 'wall'

  return { prevFlags: flags }
}

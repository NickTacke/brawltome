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
  // Ground + first-air impulse. BH native is 57 u/frame applied against
  // a heavier gravity than ours; direct translation over-shot the real
  // on-screen arc so these are tuned down to match the viewer. The
  // second air jump keeps a ~1.14x ratio so the "last jump is bigger"
  // feel survives (§_-Z1H§.as:7208).
  jumpImpulse: 1500,
  secondAirJumpImpulse: 1700,
  shortJumpMult: 0.86,
  gravity: 3500,
  maxFallSpeed: 1800,
  // Half-life ~4.3 ticks (~72ms) at 60Hz. Placeholder; BMG's actual value
  // is unknown to us, but this feels closer to the real game than snap-to-0.
  groundFriction: 0.85,
  // Air control accel of 2500 u/s^2 lets the entity approach walkSpeed in
  // ~0.28s of airtime, which roughly matches BH's "sluggish but useable"
  // air drift. Per `§_-D1C§.as` source the engine uses a fractional-per-
  // tick multiplier rather than a constant accel, but 2500 u/s^2 is a
  // close V1 approximation.
  airAccel: 2500,
  // Fast-fall multiplier applied to gravity while Drop is held in the air.
  // BH's engine removes the fall-speed cap rather than multiplying gravity,
  // but doubling gravity gives a similar feel without a second clamp.
  fastFallMult: 1.8,
}

// Below this horizontal speed, friction collapses to zero so we don't
// accumulate floating-point dribble indefinitely.
const FRICTION_CUTOFF = 5

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
// the remaining mid-air jumps before needing to touch ground again, and
// the dash/dodge window.
export type EntityPhysState = {
  prevFlags: number
  jumpsRemaining: number
  // Absolute ms until which a DodgeDash burst overrides normal movement.
  // 0 means the entity is not dashing.
  dashUntilMs: number
  // Direction of the active dash (+1 or -1). Ignored unless dashUntilMs > ms.
  dashDir: number
}

export function makePhysState(): EntityPhysState {
  return { prevFlags: 0, jumpsRemaining: DEFAULT_MAX_JUMPS, dashUntilMs: 0, dashDir: 0 }
}

// Dash parameters: BH's dash lasts ~40 frames at ~1.75x walk speed. Source
// (§_-H1Y§.as:§_-r27§ = 40) confirms the duration; the 1.75x multiplier is
// an empirical best-fit from the subagent report until we pin down the
// actual impulse constant.
const DASH_DURATION_MS = (40 * 1000) / 60
const DASH_SPEED_MULT = 1.75

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

// Range within which an airborne entity is considered pressed against a
// vertical hard line (wall-slide / wall-stick posture). Matches the probe
// width used in collision.classifyPosture.
const WALL_ADJACENT_PX = 8

// True if `pos` is inside the y-range of any vertical hard line and within
// WALL_ADJACENT_PX of it horizontally. Used to refine posture from 'air' to
// 'wall' after collision resolution, so that entities sliding down walls
// register as wall time instead of just the single tick they bumped.
function isAdjacentToWall(pos: Vec2, level: LevelGeometry): boolean {
  for (const c of level.collisions) {
    if (c.kind !== 'hard') continue
    if (!isVertical(c)) continue
    if (pos.y < Math.min(c.y1, c.y2) || pos.y > Math.max(c.y1, c.y2)) continue
    if (Math.abs(pos.x - c.x1) <= WALL_ADJACENT_PX) return true
  }
  return false
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
// the new EntityPhysState. `nowMs` lets the dash window track absolute time;
// callers that don't need dashes can pass 0 and the branch is a no-op.
export function stepEntity(
  entity: EntityState,
  flags: number,
  phys: EntityPhysState,
  level: LevelGeometry,
  params: PhysicsParams = DEFAULT_PHYSICS,
  nowMs = 0,
): EntityPhysState {
  const leftHeld = (flags & InputFlag.MoveLeft) !== 0
  const rightHeld = (flags & InputFlag.MoveRight) !== 0
  const inputDir = leftHeld && !rightHeld ? -1 : rightHeld && !leftHeld ? 1 : 0

  // Dash: edge-triggered DodgeDash press starts a ~667ms high-speed burst.
  // Direction prefers currently-held horizontal input, falls back to the
  // entity's facing (so a neutral-direction press dashes forward).
  const dashNow = (flags & InputFlag.DodgeDash) !== 0
  const dashPrev = (phys.prevFlags & InputFlag.DodgeDash) !== 0
  let dashUntilMs = phys.dashUntilMs
  let dashDir = phys.dashDir
  if (dashNow && !dashPrev) {
    dashDir = inputDir !== 0 ? inputDir : entity.facing
    dashUntilMs = nowMs + DASH_DURATION_MS
    entity.facing = dashDir < 0 ? -1 : 1
  }
  const isDashing = nowMs < dashUntilMs && dashDir !== 0

  // Horizontal motion by state: dash overrides everything, then ground walk,
  // then air drift (acceleration toward input dir, no hard cap).
  if (isDashing) {
    entity.vel.x = dashDir * params.walkSpeed * DASH_SPEED_MULT
    if (inputDir !== 0) entity.facing = inputDir < 0 ? -1 : 1
  } else if (entity.posture === 'ground') {
    if (inputDir !== 0) {
      entity.vel.x = inputDir * params.walkSpeed
      entity.facing = inputDir < 0 ? -1 : 1
    } else {
      entity.vel.x *= params.groundFriction
      if (Math.abs(entity.vel.x) < FRICTION_CUTOFF) entity.vel.x = 0
    }
  } else {
    // Air: accelerate toward input direction, clamp to walkSpeed on either
    // side so air drift doesn't exceed ground walk speed.
    if (inputDir !== 0) {
      entity.vel.x += inputDir * params.airAccel * TICK_S
      if (entity.vel.x > params.walkSpeed) entity.vel.x = params.walkSpeed
      else if (entity.vel.x < -params.walkSpeed) entity.vel.x = -params.walkSpeed
      entity.facing = inputDir < 0 ? -1 : 1
    }
  }

  // Jump: edge-triggered. Ground and air jumps draw from the same budget
  // of DEFAULT_MAX_JUMPS. Walking off a ledge doesn't consume one
  // (posture flips to air without a Jump press). A jump during a dash
  // preserves the dash horizontal velocity, producing BH's "dash-jump"
  // arc. The final jump in the budget (jumpsRemaining === 1 before
  // consumption) uses a higher impulse per BH (the "2nd air jump" path
  // in the decompiled state machine).
  const jumpNow = (flags & InputFlag.Jump) !== 0
  const jumpPrev = (phys.prevFlags & InputFlag.Jump) !== 0
  let jumpsRemaining = phys.jumpsRemaining
  if (jumpNow && !jumpPrev && jumpsRemaining > 0) {
    const impulse = jumpsRemaining === 1 ? params.secondAirJumpImpulse : params.jumpImpulse
    entity.vel.y = -impulse
    entity.posture = 'air'
    jumpsRemaining -= 1
  }

  // Short-press jump: tapping rather than holding Jump clamps upward
  // velocity to shortJumpMult * impulse while the player is still
  // rising. BH does this with a 0.86x multiplier (§_-Z1H§.as:7071).
  if (!jumpNow && jumpPrev && entity.vel.y < 0) {
    const clamped = -params.jumpImpulse * params.shortJumpMult
    if (entity.vel.y < clamped) entity.vel.y = clamped
  }

  // Gravity when airborne, scaled up if the player is fast-falling.
  if (entity.posture !== 'ground') {
    const dropHeld = (flags & InputFlag.Drop) !== 0
    const grav = dropHeld ? params.gravity * params.fastFallMult : params.gravity
    entity.vel.y = Math.min(entity.vel.y + grav * TICK_S, params.maxFallSpeed)
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

  // If we hit a wall while grounded, posture stays 'ground'. If airborne,
  // refine to 'wall' either because we just crossed one or because we're
  // flush against one this tick (wall-slide: falling alongside a wall even
  // when horizontal velocity is zero).
  if (entity.posture === 'air') {
    if (wallX !== null || isAdjacentToWall(entity.pos, level)) entity.posture = 'wall'
  }

  return { prevFlags: flags, jumpsRemaining, dashUntilMs, dashDir }
}

// True if `pos` lies outside any non-null killBound. Exposed so callers can
// detect a kill about to happen (e.g. to reset held items before respawn)
// before they invoke checkKillAndRespawn.
export function isOutOfBounds(pos: Vec2, level: LevelGeometry): boolean {
  const { left, right, top, bottom } = level.killBounds
  return (
    (left !== null && pos.x < left) ||
    (right !== null && pos.x > right) ||
    (top !== null && pos.y < top) ||
    (bottom !== null && pos.y > bottom)
  )
}

// If the entity has crossed any non-null killBound, snap it back to the given
// respawn point with zeroed velocity and a full jump budget. Returns the
// physics state either unchanged (no kill) or with jumps reset.
//
// Instant respawn (no death animation or stock cost) is enough for V1: the
// aggregate posture metric just needs entities to stop falling into the void
// forever so we can run full-match sims without garbage tail frames.
export function checkKillAndRespawn(
  entity: EntityState,
  level: LevelGeometry,
  respawnPoint: Vec2,
  phys: EntityPhysState,
): EntityPhysState {
  if (!isOutOfBounds(entity.pos, level)) return phys
  entity.pos.x = respawnPoint.x
  entity.pos.y = respawnPoint.y
  entity.vel.x = 0
  entity.vel.y = 0
  entity.posture = 'air'
  return { prevFlags: phys.prevFlags, jumpsRemaining: DEFAULT_MAX_JUMPS }
}

// 1:1 port of Brawlhalla's 60Hz physics loop. Every constant and the
// integration model come straight from the decompiled source:
//
//   research/jpexs/out-10.05/scripts/§_-U4U§.as:168       -> BH_TIMESTEP = 0.384
//   research/jpexs/out-10.05/scripts/§_-Z1H§.as:1166      -> base gravity = 3.75 u/frame
//   research/jpexs/out-10.05/scripts/§_-Z1H§.as:1170-1171 -> ground/air accel 5.16 / 4.7
//   research/jpexs/out-10.05/scripts/§_-Z1H§.as:406-412   -> jump impulses 57 (ground/1st air), 65 (last)
//   research/jpexs/out-10.05/scripts/§_-Z1H§.as:522-524   -> walk-speed cap 700, fall-speed cap 350
//   research/jpexs/out-10.05/scripts/§_-Z1H§.as:404       -> ground friction multiplier 0.85
//
// BH integrates velocity and position like this every frame:
//   vel.y += BASE_GRAVITY * BH_TIMESTEP           // effective +1.44 per tick
//   vel.x += BASE_GROUND_ACCEL * BH_TIMESTEP      // effective +1.98 per tick
//   pos   += vel * BH_TIMESTEP                    // subsecond integration
//
// So an impulse `vel.y = -57` produces a jump apex of 57^2 / (2 * 1.44) = 1128
// in velocity-space, which becomes 1128 * 0.384 ~= 433 screen units. That's
// the ~2-character-heights arc players actually see. We keep those native
// numbers and apply the timestep in code, rather than shoe-horning them
// into our old per-second convention.

import type { CollisionLine, LevelGeometry } from '@brawltome/game-data'
import { InputFlag } from '@brawltome/replay-format'
import type { EntityState, PhysicsParams, Vec2 } from './types'

// BH's per-tick integration multiplier. Applied to every velocity delta
// and position update. Sourced from §_-U4U§.as:168.
export const BH_TIMESTEP = 0.384

export const DEFAULT_PHYSICS: PhysicsParams = {
  // Horizontal velocity cap (§_-Z1H§.as:522: §_-l3q§ = 700). Acts as a
  // hard clamp on vel.x, not a target velocity.
  walkSpeed: 700,
  // One-time velocity set on Jump press. Ground + first-air use the same
  // magnitude; the last jump available uses 65 (higher, so recoveries
  // arc taller than an opener jump).
  jumpImpulse: 57,
  secondAirJumpImpulse: 65,
  shortJumpMult: 0.86,
  // Base per-frame gravity coefficient; the effective per-tick vel.y
  // increment is `gravity * BH_TIMESTEP`.
  gravity: 3.75,
  // Clamp on vel.y downward (§_-Z1H§.as:524: §_-l3I§ = 350). Different
  // from BH's separate ground-state cap which we may split out later if
  // we observe terminal-velocity mismatches.
  maxFallSpeed: 350,
  groundFriction: 0.85,
  // Ground and air horizontal accel coefficients. Each tick adds
  // `accel * BH_TIMESTEP * direction` to vel.x, which makes ramp-up
  // to walkSpeed take ~135 ticks (2.25 s).
  airAccel: 4.7,
  // Fast-fall multiplier. BH raises the fall cap rather than scaling
  // gravity directly; for V1 we keep it as a gravity scalar.
  fastFallMult: 1.8,
}

export const GROUND_ACCEL = 5.16

// Below this horizontal speed (post-friction), vel.x snaps to zero so we
// don't accumulate floating-point dribble indefinitely. Tiny per-tick
// value now that we're in per-tick velocity units (was 5 in per-sec).
const FRICTION_CUTOFF = 0.1

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

// Finds the topmost horizontal surface that the entity's fall from `oldY`
// to `pos.y` crosses, or rests near within `maxDrop`. Hard / no_slide lines
// are always solid from both sides; soft platforms are solid only when the
// entity is approaching from above (oldY above the line) and not holding
// drop-through. Anchoring the distance check to `oldY` matters when the
// entity overshoots a floor in a single tick, which happens at BH's
// per-tick fall speed (~134 units at the cap).
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
    const dy = c.y1 - oldY
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

  // Horizontal motion: ground and air use separate accel coefficients
  // (GROUND_ACCEL vs params.airAccel) applied per tick through the
  // BH_TIMESTEP multiplier. Velocity is capped at params.walkSpeed on
  // both sides. No snap-to-target; BH accelerates you toward the cap
  // over many frames, which is why walking feels weighty.
  if (isDashing) {
    entity.vel.x = dashDir * params.walkSpeed * DASH_SPEED_MULT
    if (inputDir !== 0) entity.facing = inputDir < 0 ? -1 : 1
  } else if (entity.posture === 'ground') {
    if (inputDir !== 0) {
      entity.vel.x += inputDir * GROUND_ACCEL * BH_TIMESTEP
      if (entity.vel.x > params.walkSpeed) entity.vel.x = params.walkSpeed
      else if (entity.vel.x < -params.walkSpeed) entity.vel.x = -params.walkSpeed
      entity.facing = inputDir < 0 ? -1 : 1
    } else {
      entity.vel.x *= params.groundFriction
      if (Math.abs(entity.vel.x) < FRICTION_CUTOFF) entity.vel.x = 0
    }
  } else if (inputDir !== 0) {
    entity.vel.x += inputDir * params.airAccel * BH_TIMESTEP
    if (entity.vel.x > params.walkSpeed) entity.vel.x = params.walkSpeed
    else if (entity.vel.x < -params.walkSpeed) entity.vel.x = -params.walkSpeed
    entity.facing = inputDir < 0 ? -1 : 1
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

  // Gravity when airborne. BH applies `vel.y += base_gravity * BH_TIMESTEP`
  // per frame and clamps at maxFallSpeed; fast-fall scales gravity up.
  if (entity.posture !== 'ground') {
    const dropHeld = (flags & InputFlag.Drop) !== 0
    const grav = dropHeld ? params.gravity * params.fastFallMult : params.gravity
    entity.vel.y = Math.min(entity.vel.y + grav * BH_TIMESTEP, params.maxFallSpeed)
  }

  // Position integration uses the same BH_TIMESTEP multiplier on velocity
  // (§_-Z1H§.as:3721 shows `screen_y = vel_y * 0.384`). So position moves
  // `vel * 0.384` per tick, not `vel * tick_seconds`.
  const startX = entity.pos.x
  const targetX = startX + entity.vel.x * BH_TIMESTEP
  const wallX = wallCrossed(entity.pos.y, startX, targetX, level)
  if (wallX !== null) {
    const dir = targetX > startX ? 1 : -1
    entity.pos.x = wallX - dir * EPSILON
    entity.vel.x = 0
  } else {
    entity.pos.x = targetX
  }

  const startY = entity.pos.y
  const dropThrough = (flags & InputFlag.Drop) !== 0
  const posDeltaY = entity.vel.y * BH_TIMESTEP
  entity.pos.y += posDeltaY
  if (entity.vel.y >= 0) {
    const floorY = groundBeneath(entity.pos, startY, level, Math.max(8, posDeltaY + 2), dropThrough)
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

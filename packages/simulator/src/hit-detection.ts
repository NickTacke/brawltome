import { type Power, getPowerByName } from '@brawltome/game-data'
import type { EntityState } from './types'

// First-pass hitbox simulation. The real BH pipeline (per the decompiled
// source) walks castTime phases to know when each hitbox slot is active,
// builds an AABB around attacker.pos + centerOffset, and checks it against
// per-animation-frame hurtboxes on every opponent. We model a coarser
// version:
//
//   - Parse each castTime phase as an `@activeStart[-activeEnd]` frame
//     window. The phase's hitbox slot indexes into Power.centerOffset and
//     Power.baseDamage; we use the highest-damage slot to approximate the
//     "main" hit since multi-phase selection is probabilistic in the engine.
//   - Assume 60Hz animation frames equal simulation ticks (Brawlhalla runs
//     its game logic at 60Hz, same as us), so a phase active at frames F..G
//     translates to ms [F*16.67, G*16.67] after the press.
//   - Opponent hurtbox is a fixed body AABB (145x160 by default) centred
//     on their position. Per-frame opponent hurtboxes exist in the data
//     but require animation-state tracking we don't have yet.
//   - Per-(attacker, defender) cooldown of 250ms prevents a single attack
//     from triggering multiple hits against the same defender across
//     consecutive active ticks.

const FRAME_MS = 1000 / 60
const SAME_TARGET_COOLDOWN_MS = 250

const DEFAULT_OPPONENT_HURTBOX = { width: 145, height: 160, offsetY: -80 }

export type AttackWindow = {
  attackerId: number
  power: Power
  pressMs: number
  hitboxIdx: number
  // Absolute ms bounds during which this hitbox is live.
  activeStartMs: number
  activeEndMs: number
}

// Parses Power.castTime into one absolute-ms window spanning the union of
// every active frame range across all phases. Empirically, castTime's
// `:N` middle number doesn't reliably index into baseDamage for many
// moves, so we ignore it and use argmax(baseDamage) as the hitbox slot.
// That matches how the engine seems to pick "the" damaging hit per press
// - whichever slot carries the highest base damage. Multi-hit registers
// are flattened into a single window; the per-(attacker,defender,power)
// cooldown keeps it from double-triggering across consecutive ticks.
export function planAttackWindows(power: Power, attackerId: number, pressMs: number): AttackWindow[] {
  const phases = parseCastTimePhases(power.castTime)
  if (phases.length === 0) return []
  const hitboxIdx = argmax(power.baseDamage)
  if (hitboxIdx < 0) return []
  const firstStart = phases[0].activeStart
  let minStart = firstStart
  let maxEnd = phases[0].activeEnd ?? firstStart
  for (const p of phases.slice(1)) {
    if (p.activeStart < minStart) minStart = p.activeStart
    const end = p.activeEnd ?? p.activeStart
    if (end > maxEnd) maxEnd = end
  }
  // Widen the window by half a frame either side to absorb rounding at
  // the 60Hz tick boundary. Now that knockback applies, we can be more
  // faithful to BH's actual active-frame windows instead of the wider
  // compensation the pre-knockback sim needed.
  const startMs = pressMs + minStart * FRAME_MS - FRAME_MS / 2
  const endMs = pressMs + maxEnd * FRAME_MS + FRAME_MS / 2
  return [{ attackerId, power, pressMs, hitboxIdx, activeStartMs: startMs, activeEndMs: endMs }]
}

function argmax(arr: readonly number[]): number {
  if (arr.length === 0) return -1
  let idx = 0
  let best = arr[0]
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > best) {
      best = arr[i]
      idx = i
    }
  }
  return idx
}

type Phase = { hitboxIdx: number; activeStart: number; activeEnd: number | null }

function parseCastTimePhases(castTime: string): Phase[] {
  if (!castTime) return []
  const out: Phase[] = []
  for (const raw of castTime.split(',')) {
    // Accept `frame:idx@start[-end]`, `:idx@start[-end]`, or bare `@start`.
    // The second number after the colon is the hitbox index.
    const m = raw.match(/^(\d*):?(\d+)?@(\d+)(?:-(\d+))?$/)
    if (!m) continue
    const hitboxIdx = m[2] !== undefined ? Number(m[2]) : 0
    const activeStart = Number(m[3])
    const activeEnd = m[4] !== undefined ? Number(m[4]) : null
    if (!Number.isFinite(activeStart)) continue
    out.push({ hitboxIdx, activeStart, activeEnd })
  }
  return out
}

// AABB overlap in pixel/unit space.
function overlaps(
  ax: number,
  ay: number,
  arw: number,
  arh: number,
  bx: number,
  by: number,
  brw: number,
  brh: number,
): boolean {
  return Math.abs(ax - bx) <= arw + brw && Math.abs(ay - by) <= arh + brh
}

// World-space hitbox AABB for an active attack window.
export type HitboxAabb = {
  cx: number
  cy: number
  halfW: number
  halfH: number
}

export function windowHitbox(window: AttackWindow, attacker: EntityState): HitboxAabb | null {
  const { power, hitboxIdx } = window
  const halfW = power.aoeRadiusX[hitboxIdx] ?? 0
  const halfH = power.aoeRadiusY[hitboxIdx] ?? 0
  if (halfW <= 0 || halfH <= 0) return null
  const cx = attacker.pos.x + (power.centerOffsetX[hitboxIdx] ?? 0) * attacker.facing
  const cy = attacker.pos.y + (power.centerOffsetY[hitboxIdx] ?? 0)
  return { cx, cy, halfW, halfH }
}

// If a pair of hitboxes overlap we treat it as a clash: both attacks are
// replaced by ClashLight (or ClashHeavy when both isSignature), neither
// side takes baseDamage from the original hit, and each attacker gets the
// clash power's knockback + hitstun. Caller walks pairs of different-team
// windows and invokes this for every overlap.
export function detectClash(
  aWindow: AttackWindow,
  aAttacker: EntityState,
  bWindow: AttackWindow,
  bAttacker: EntityState,
): Power | null {
  if (aAttacker.team === bAttacker.team) return null
  const aBox = windowHitbox(aWindow, aAttacker)
  const bBox = windowHitbox(bWindow, bAttacker)
  if (!aBox || !bBox) return null
  if (!overlaps(aBox.cx, aBox.cy, aBox.halfW, aBox.halfH, bBox.cx, bBox.cy, bBox.halfW, bBox.halfH)) {
    return null
  }
  const bothSig = aWindow.power.isSignature && bWindow.power.isSignature
  const name = bothSig ? 'ClashHeavy' : 'ClashLight'
  return getPowerByName(name) ?? null
}

// Checks every live AttackWindow at `nowMs`. For each window whose active
// range covers now, tests overlap against every alive opponent entity and
// records a LandedHit if the same (attacker,defender) pair isn't on cooldown.
// Mutates `cooldowns` and `hits`. Windows whose activeEnd has passed
// should be pruned by the caller.
export type LandedHit = {
  attackerId: number
  defenderId: number
  ms: number
  powerId: number
  baseDamage: number
}

export function checkWindow(
  window: AttackWindow,
  nowMs: number,
  attacker: EntityState,
  opponents: readonly EntityState[],
  cooldowns: Map<string, number>,
): LandedHit[] {
  if (nowMs < window.activeStartMs || nowMs > window.activeEndMs) return []
  const { power, hitboxIdx, attackerId } = window
  const hbHalfW = power.aoeRadiusX[hitboxIdx] ?? 0
  const hbHalfH = power.aoeRadiusY[hitboxIdx] ?? 0
  if (hbHalfW <= 0 || hbHalfH <= 0) return []
  const cx = attacker.pos.x + (power.centerOffsetX[hitboxIdx] ?? 0) * attacker.facing
  const cy = attacker.pos.y + (power.centerOffsetY[hitboxIdx] ?? 0)

  const hits: LandedHit[] = []
  for (const opp of opponents) {
    if (!opp.alive) continue
    const cdKey = `${attackerId}->${opp.id}:${power.powerId}`
    const lastHit = cooldowns.get(cdKey) ?? Number.NEGATIVE_INFINITY
    if (nowMs - lastHit < SAME_TARGET_COOLDOWN_MS) continue
    const bx = opp.pos.x
    const by = opp.pos.y + DEFAULT_OPPONENT_HURTBOX.offsetY
    if (
      !overlaps(
        cx,
        cy,
        hbHalfW,
        hbHalfH,
        bx,
        by,
        DEFAULT_OPPONENT_HURTBOX.width / 2,
        DEFAULT_OPPONENT_HURTBOX.height / 2,
      )
    )
      continue
    const dmg = power.baseDamage[hitboxIdx] ?? 0
    if (dmg <= 0) continue
    cooldowns.set(cdKey, nowMs)
    hits.push({
      attackerId,
      defenderId: opp.id,
      ms: nowMs,
      powerId: power.powerId,
      baseDamage: dmg,
    })
  }
  return hits
}

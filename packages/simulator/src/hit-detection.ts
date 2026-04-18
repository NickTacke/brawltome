import type { Power } from '@brawltome/game-data'
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

// Parses Power.castTime into absolute-ms windows during which the power's
// hitbox is live. Format:
//   `[frames]:[hitboxIdx]@activeStart[-activeEnd]`, phases joined by ','.
// The leading frames+hitboxIdx describe animation state; the `@` range
// is the frame window the hitbox is active. Missing end = same as start.
//
// A move with N phases plants N windows: one per phase, each pointing at
// its own hitbox slot. That way multi-hit moves like HammerSide
// ("9:2@4,0:3@5,0:4@6-6") each get their own live window, position, and
// damage contribution, rather than collapsing to one.
export function planAttackWindows(
  power: Power,
  attackerId: number,
  pressMs: number,
): AttackWindow[] {
  const phases = parseCastTimePhases(power.castTime)
  const windows: AttackWindow[] = []
  for (const phase of phases) {
    // Widen 1-frame windows by half a frame on each side so the hit has
    // a chance to register at our 60Hz tick boundary alignment. Real BH
    // runs hitboxes at 60Hz so this mostly catches rounding.
    const startMs = pressMs + phase.activeStart * FRAME_MS - FRAME_MS / 2
    const endMsRaw = pressMs + (phase.activeEnd ?? phase.activeStart) * FRAME_MS + FRAME_MS / 2
    windows.push({
      attackerId,
      power,
      pressMs,
      hitboxIdx: phase.hitboxIdx,
      activeStartMs: startMs,
      activeEndMs: endMsRaw,
    })
  }
  return windows
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
    const lastHit = cooldowns.get(cdKey) ?? -Infinity
    if (nowMs - lastHit < SAME_TARGET_COOLDOWN_MS) continue
    const bx = opp.pos.x
    const by = opp.pos.y + DEFAULT_OPPONENT_HURTBOX.offsetY
    if (!overlaps(cx, cy, hbHalfW, hbHalfH, bx, by, DEFAULT_OPPONENT_HURTBOX.width / 2, DEFAULT_OPPONENT_HURTBOX.height / 2)) continue
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

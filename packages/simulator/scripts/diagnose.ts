/**
 * Diagnostic harness: loads a replay fixture, runs the simulation, and prints
 * per-entity posture breakdowns plus a few sanity stats. This is NOT a test;
 * it is a tool for eyeballing what the sim actually produces on real data so
 * we can tell whether the physics model is in the right ballpark before
 * sweeping constants.
 *
 * Run:
 *   bun run scripts/diagnose.ts <replay.replay> [stats.json]
 *
 * If a Brawlhalla stats JSON is supplied as the second argument, the script
 * also prints a tick-level weapon-in-hand agreement score so we can tune
 * pickup parameters against ground truth.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  getLegendById,
  getLevelById,
  getPowerById,
  getPowerByName,
  levelGeometry,
} from '@brawltome/game-data'
import { parse } from '@brawltome/replay-format'
import {
  estimatePowerDamage,
  strengthMultiplier,
  weightMultiplier,
} from '../src/damage-estimator'
import { Simulation } from '../src/sim'
import { TICK_MS } from '../src/tick'
import { loadStats, statsPlayers, weaponAtMs } from './stats-loader'

function pct(part: number, total: number): string {
  if (total === 0) return '  0.0%'
  return `${((part / total) * 100).toFixed(1).padStart(5, ' ')}%`
}

function fmt(n: number, width = 8, decimals = 1): string {
  return n.toFixed(decimals).padStart(width, ' ')
}

function diagnose(path: string, statsPath?: string): void {
  if (!existsSync(path)) {
    console.error(`fixture not found: ${path}`)
    process.exit(1)
  }
  const raw = new Uint8Array(readFileSync(path))
  const parsed = parse(raw, { inputs: true })
  const stats = statsPath ? loadStats(statsPath) : null

  const meta = getLevelById(parsed.levelId)
  if (!meta) throw new Error(`no LevelMeta for levelId ${parsed.levelId}`)
  const geo = levelGeometry[meta.levelName]
  if (!geo) throw new Error(`no LevelGeometry for levelName ${meta.levelName}`)

  const lengthMs = parsed.results[0]?.lengthMs ?? 0
  console.log(`\n=== ${basename(path)} ===`)
  console.log(`level:       ${meta.displayName} (${meta.levelName})`)
  console.log(`length:      ${(lengthMs / 1000).toFixed(1)}s`)
  console.log(`entities:    ${parsed.entities.length}`)
  console.log(`camera:      ${JSON.stringify(geo.cameraBounds)}`)
  console.log(`killBounds:  ${JSON.stringify(geo.killBounds)}`)
  console.log(`respawns:    ${geo.respawns.length} points`)
  console.log(`collisions:  ${geo.collisions.length} lines`)

  const sim = new Simulation({ parsed, geometry: geo })
  const totals = sim.postureTotals()
  const attacks = sim.attackAttempts()
  const pickups = sim.pickupCountsByEntity()
  const weaponTime = sim.weaponTimeByEntity()

  console.log(`\nlegend per entity:`)
  for (const ent of parsed.entities) {
    const heroId = ent.playerData.heroes[0]?.heroId
    const legend = heroId !== undefined ? getLegendById(heroId) : undefined
    console.log(
      `  ${String(ent.id).padStart(3, ' ')} ${ent.name.padEnd(16, ' ')} heroId=${heroId ?? '?'}  internal=${legend?.heroName ?? '?'}  weapons=${legend?.weaponOne ?? '?'}/${legend?.weaponTwo ?? '?'}`,
    )
  }

  console.log(`\nposture breakdown per entity:`)
  console.log(`  id  name              air     ground  wall    sum(ms)   match(ms)`)
  for (const t of totals) {
    const ent = parsed.entities.find((e) => e.id === t.entityId)
    const name = ent ? `${ent.name}`.padEnd(16, ' ') : '?'.padEnd(16, ' ')
    const sum = t.air + t.ground + t.wall
    console.log(
      `  ${String(t.entityId).padStart(3, ' ')} ${name} ${pct(t.air, sum)} ${pct(t.ground, sum)} ${pct(t.wall, sum)} ${fmt(sum, 8, 0)}   ${fmt(lengthMs, 8, 0)}`,
    )
  }

  const minutes = lengthMs / 60000
  const buttons = ['light', 'heavy', 'dodge', 'throw'] as const
  console.log(`\nattack-attempt counts (edge-triggered presses, not landed hits):`)
  console.log(`  id  name             light  heavy  dodge  throw   total   per-min`)
  for (const t of totals) {
    const ent = parsed.entities.find((e) => e.id === t.entityId)
    const name = ent ? `${ent.name}`.padEnd(16, ' ') : '?'.padEnd(16, ' ')
    const byButton: Record<string, number> = { light: 0, heavy: 0, dodge: 0, throw: 0 }
    let total = 0
    for (const a of attacks) {
      if (a.entityId !== t.entityId) continue
      byButton[a.button] += 1
      total += 1
    }
    const cols = buttons.map((b) => String(byButton[b]).padStart(5, ' ')).join('  ')
    const perMin = minutes > 0 ? total / minutes : 0
    console.log(
      `  ${String(t.entityId).padStart(3, ' ')} ${name} ${cols}   ${String(total).padStart(5, ' ')}    ${perMin.toFixed(1).padStart(5, ' ')}`,
    )
  }

  // Dump up to 20 unresolvable attempts (by entity) so we can see which
  // input combos the resolver is missing.
  console.log(`\nunresolvable attempt samples (first 4 per entity):`)
  const perEntitySamples = new Map<number, string[]>()
  for (const a of attacks) {
    if (a.powerId !== null || a.button === 'dodge') continue
    const arr = perEntitySamples.get(a.entityId) ?? []
    if (arr.length < 4) {
      arr.push(`${a.button}+${a.direction}+${a.posture}`)
      perEntitySamples.set(a.entityId, arr)
    }
  }
  for (const t of totals) {
    const ent = parsed.entities.find((e) => e.id === t.entityId)
    const name = ent ? `${ent.name}`.padEnd(16, ' ') : '?'.padEnd(16, ' ')
    const samples = perEntitySamples.get(t.entityId) ?? []
    console.log(`  ${name} ${samples.join(' | ')}`)
  }

  console.log(`\nweapon pickups + time held per entity:`)
  console.log(`  id  name             pickups    weapon-held (ms)`)
  for (const t of totals) {
    const ent = parsed.entities.find((e) => e.id === t.entityId)
    const name = ent ? `${ent.name}`.padEnd(16, ' ') : '?'.padEnd(16, ' ')
    const count = pickups.get(t.entityId) ?? 0
    const byWeapon = weaponTime.get(t.entityId)
    const parts: string[] = []
    if (byWeapon) {
      for (const [w, ms] of byWeapon.entries()) parts.push(`${w}=${ms}`)
    }
    console.log(
      `  ${String(t.entityId).padStart(3, ' ')} ${name} ${String(count).padStart(7, ' ')}    ${parts.join(', ')}`,
    )
  }

  // Damage-attempted upper bound per press: resolved Power's base damage
  // (via estimator) scaled by the attacker's strength and the average
  // opponent weight multiplier. Assumes every press connects to a target
  // from the opposing team; ignores stage knockback and crouch-cancel
  // reductions which would reduce the number further.
  const entityTeam = new Map<number, number>()
  const entityWeight = new Map<number, number>()
  for (const ent of parsed.entities) {
    entityTeam.set(ent.id, ent.team)
    const hid = ent.playerData.heroes[0]?.heroId
    const lg = hid !== undefined ? getLegendById(hid) : undefined
    entityWeight.set(ent.id, lg?.weight ?? 5)
  }
  const avgOpponentWeight = (attackerId: number): number => {
    const team = entityTeam.get(attackerId)
    const weights: number[] = []
    for (const [eid, t] of entityTeam.entries()) {
      if (t !== team) weights.push(entityWeight.get(eid) ?? 5)
    }
    if (weights.length === 0) return 5
    return weights.reduce((s, w) => s + w, 0) / weights.length
  }

  console.log(
    `\ndamage-attempted (estimator * strength * avg-opponent-weight; upper bound):`,
  )
  console.log(`  id  name             resolved  unresolvable  damage  per-min`)
  for (const t of totals) {
    const ent = parsed.entities.find((e) => e.id === t.entityId)
    const name = ent ? `${ent.name}`.padEnd(16, ' ') : '?'.padEnd(16, ' ')
    const heroId = ent?.playerData.heroes[0]?.heroId
    const legend = heroId !== undefined ? getLegendById(heroId) : undefined
    const strMult = legend ? strengthMultiplier(legend.strength) : 1
    const weightMult = weightMultiplier(avgOpponentWeight(t.entityId))
    let resolved = 0
    let unresolvable = 0
    let damage = 0
    for (const a of attacks) {
      if (a.entityId !== t.entityId) continue
      if (a.powerId === null) {
        if (a.button !== 'dodge') unresolvable += 1
        continue
      }
      resolved += 1
      const p = getPowerById(a.powerId)
      if (p) damage += estimatePowerDamage(p, getPowerByName) * strMult * weightMult
    }
    const perMin = minutes > 0 ? damage / minutes : 0
    console.log(
      `  ${String(t.entityId).padStart(3, ' ')} ${name} ${String(resolved).padStart(8, ' ')}  ${String(unresolvable).padStart(12, ' ')}  ${damage.toFixed(1).padStart(6, ' ')}   ${perMin.toFixed(1).padStart(5, ' ')}`,
    )
  }

  if (!stats) return

  // Walk both weapon-in-hand timelines tick by tick, counting how many ticks
  // agree on the weapon. Players are matched by name; unmatched entities are
  // skipped. The stats JSON holds the canonical "real" timeline.
  console.log(`\n=== stats comparison (vs ${basename(statsPath ?? '?')}) ===`)
  const simChanges = sim.weaponChangesByEntity()
  const players = statsPlayers(stats)

  // Stats DamageDealt vs sim upper-bound damage.
  console.log(`\ndamage: real DamageDealt vs sim upper-bound:`)
  console.log(`  name              real     sim     delta`)
  for (const p of players) {
    const ent = parsed.entities.find((e) => e.name === p.PlayerName)
    if (!ent) continue
    const heroId = ent.playerData.heroes[0]?.heroId
    const legend = heroId !== undefined ? getLegendById(heroId) : undefined
    const strMult = legend ? strengthMultiplier(legend.strength) : 1
    const weightMult = weightMultiplier(avgOpponentWeight(ent.id))
    let simDamage = 0
    for (const a of attacks) {
      if (a.entityId !== ent.id || a.powerId === null) continue
      const pw = getPowerById(a.powerId)
      if (pw) simDamage += estimatePowerDamage(pw, getPowerByName) * strMult * weightMult
    }
    const real = p.DamageDealt
    const delta = simDamage - real
    const pct = real > 0 ? (delta / real) * 100 : 0
    console.log(
      `  ${p.PlayerName.padEnd(16, ' ')} ${real.toFixed(1).padStart(7, ' ')}   ${simDamage.toFixed(1).padStart(7, ' ')}   ${(delta >= 0 ? '+' : '') + delta.toFixed(1)} (${pct.toFixed(1)}%)`,
    )
  }

  // Landed-damage from per-tick hit detection (baseDamage of resolved hits
  // summed per attacker, scaled by attacker strength + defender weight).
  const landed = sim.landedHitEvents()
  console.log(`\nlanded damage per attacker (hit-detected; real vs sim):`)
  console.log(`  name              real    sim    delta`)
  for (const p of players) {
    const ent = parsed.entities.find((e) => e.name === p.PlayerName)
    if (!ent) continue
    const heroId = ent.playerData.heroes[0]?.heroId
    const legend = heroId !== undefined ? getLegendById(heroId) : undefined
    const strMult = legend ? strengthMultiplier(legend.strength) : 1
    let simLanded = 0
    for (const h of landed) {
      if (h.attackerId !== ent.id) continue
      const def = parsed.entities.find((e) => e.id === h.defenderId)
      const defHeroId = def?.playerData.heroes[0]?.heroId
      const defLegend = defHeroId !== undefined ? getLegendById(defHeroId) : undefined
      const wMult = weightMultiplier(defLegend?.weight ?? 5)
      simLanded += h.baseDamage * strMult * wMult
    }
    const delta = simLanded - p.DamageDealt
    console.log(
      `  ${p.PlayerName.padEnd(16, ' ')} ${p.DamageDealt.toFixed(1).padStart(6, ' ')}  ${simLanded.toFixed(1).padStart(6, ' ')}   ${(delta >= 0 ? '+' : '') + delta.toFixed(1)}`,
    )
  }

  // Per-player weapon-in-hand agreement: fraction of ticks where the sim's
  // heldWeapon matches the stats Sequence's weapon at the same ms.
  console.log(`\nweapon-in-hand agreement per tick:`)
  console.log(`  name              ticks   match     %`)
  for (const p of players) {
    const ent = parsed.entities.find((e) => e.name === p.PlayerName)
    if (!ent) continue
    const simTl = [{ ms: 0, weapon: 'Base' }, ...(simChanges.get(ent.id) ?? [])]
    let ticks = 0
    let matches = 0
    let simIdx = 0
    for (let ms = 0; ms <= lengthMs; ms += TICK_MS) {
      while (simIdx + 1 < simTl.length && simTl[simIdx + 1].ms <= ms) simIdx += 1
      const simWeapon = simTl[simIdx].weapon
      const realWeapon = weaponAtMs(p.Sequence, ms)
      ticks += 1
      if (simWeapon === realWeapon) matches += 1
    }
    const pct = ticks > 0 ? (matches / ticks) * 100 : 0
    console.log(
      `  ${p.PlayerName.padEnd(16, ' ')} ${String(ticks).padStart(5, ' ')}   ${String(matches).padStart(5, ' ')}   ${pct.toFixed(1).padStart(5, ' ')}`,
    )
  }

  // Per-player total ms held per weapon, sim vs stats. Stats TimeHeld fields
  // are on each weapon sub-record (e.g. p.Hammer.TimeHeld).
  console.log(`\ntime held per weapon (ms): real vs sim`)
  for (const p of players) {
    const ent = parsed.entities.find((e) => e.name === p.PlayerName)
    if (!ent) continue
    const simByWeapon = sim.weaponTimeByEntity().get(ent.id) ?? new Map<string, number>()
    console.log(`  ${p.PlayerName}`)
    const weaponKeys = new Set<string>()
    for (const k of Object.keys(p)) {
      if (k === 'Unarmed' || (p[k as keyof typeof p] as { TimeHeld?: number })?.TimeHeld != null)
        weaponKeys.add(k === 'Unarmed' ? 'Base' : k)
    }
    for (const w of simByWeapon.keys()) weaponKeys.add(w)
    for (const w of [...weaponKeys].sort()) {
      const statsKey = w === 'Base' ? 'Unarmed' : w
      const block = (p as Record<string, unknown>)[statsKey] as
        | { TimeHeld?: number }
        | undefined
      const real = block?.TimeHeld ?? 0
      const simMs = simByWeapon.get(w) ?? 0
      console.log(
        `    ${w.padEnd(14, ' ')} real=${String(real).padStart(6, ' ')}  sim=${String(Math.round(simMs)).padStart(6, ' ')}`,
      )
    }
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: bun run scripts/diagnose.ts <replay-path> [stats.json]')
  process.exit(1)
}
const replays: string[] = []
let statsPath: string | undefined
for (const a of args) {
  if (a.endsWith('.json')) statsPath = a
  else replays.push(a)
}
for (const path of replays) diagnose(path, statsPath)

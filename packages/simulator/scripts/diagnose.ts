/**
 * Diagnostic harness: loads a replay fixture, runs the simulation, and prints
 * per-entity posture breakdowns plus a few sanity stats. This is NOT a test;
 * it is a tool for eyeballing what the sim actually produces on real data so
 * we can tell whether the physics model is in the right ballpark before
 * sweeping constants.
 *
 * Run:
 *   bun run packages/simulator/scripts/diagnose.ts packages/replay-format/tests/fixtures/mishima.replay
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { getLegendById, getLevelById, getPowerById, levelGeometry } from '@brawltome/game-data'
import { parse } from '@brawltome/replay-format'
import { Simulation } from '../src/sim'

function pct(part: number, total: number): string {
  if (total === 0) return '  0.0%'
  return `${((part / total) * 100).toFixed(1).padStart(5, ' ')}%`
}

function fmt(n: number, width = 8, decimals = 1): string {
  return n.toFixed(decimals).padStart(width, ' ')
}

function diagnose(path: string): void {
  if (!existsSync(path)) {
    console.error(`fixture not found: ${path}`)
    process.exit(1)
  }
  const raw = new Uint8Array(readFileSync(path))
  const parsed = parse(raw, { inputs: true })

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

  // Rough damage-attempted: sum of baseDamage across every resolved attempt.
  // Assumes every press connected, which it doesn't; this is an upper bound
  // for damage output, not actual damage dealt. Dodge and unresolved
  // attempts (including throws while unarmed and air-side heavies that
  // don't exist as moves) are excluded.
  console.log(
    `\nrough damage-attempted (sum of baseDamage across resolved presses, upper bound):`,
  )
  console.log(`  id  name             resolved  unresolvable  baseDamage  per-min`)
  for (const t of totals) {
    const ent = parsed.entities.find((e) => e.id === t.entityId)
    const name = ent ? `${ent.name}`.padEnd(16, ' ') : '?'.padEnd(16, ' ')
    let resolved = 0
    let unresolvable = 0
    let damage = 0
    for (const a of attacks) {
      if (a.entityId !== t.entityId) continue
      if (a.powerId === null) {
        // Dodges always return null; skip them in the unresolvable count.
        if (a.button !== 'dodge') unresolvable += 1
        continue
      }
      resolved += 1
      const p = getPowerById(a.powerId)
      if (p) damage += p.baseDamage
    }
    const perMin = minutes > 0 ? damage / minutes : 0
    console.log(
      `  ${String(t.entityId).padStart(3, ' ')} ${name} ${String(resolved).padStart(8, ' ')}  ${String(unresolvable).padStart(12, ' ')}  ${String(damage).padStart(10, ' ')}   ${perMin.toFixed(1).padStart(5, ' ')}`,
    )
  }
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: bun run scripts/diagnose.ts <replay-path> [more-replay-paths...]')
  process.exit(1)
}
for (const path of args) diagnose(path)

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
import { getLevelById, levelGeometry } from '@brawltome/game-data'
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
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: bun run scripts/diagnose.ts <replay-path> [more-replay-paths...]')
  process.exit(1)
}
for (const path of args) diagnose(path)

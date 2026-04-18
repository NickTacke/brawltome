/**
 * Sim recorder: runs a replay through the simulator and dumps per-tick
 * entity snapshots plus match-level context (level geometry, attack
 * events, landed hits) to a single JSON file. The companion viewer.html
 * loads the file and renders the match in a browser.
 *
 * Usage:
 *   bun run scripts/dump-frames.ts <replay-path> [output.json]
 *
 * Defaults to "frames.json" next to the viewer. Intended for development
 * only - file sizes are substantial (~5-10 MB for a full match) because
 * we emit every entity at every tick without deduplication.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getLegendById, getLevelById, getPowerById, levelGeometry } from '@brawltome/game-data'
import { parse } from '@brawltome/replay-format'
import { Simulation } from '../src/sim'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: bun run scripts/dump-frames.ts <replay-path> [output.json]')
  process.exit(1)
}
const replayPath = args[0]
const outPath = args[1] ?? join(dirname(fileURLToPath(import.meta.url)), 'frames.json')

if (!existsSync(replayPath)) {
  console.error(`fixture not found: ${replayPath}`)
  process.exit(1)
}

const raw = new Uint8Array(readFileSync(replayPath))
const parsed = parse(raw, { inputs: true })
const meta = getLevelById(parsed.levelId)
if (!meta) throw new Error(`no LevelMeta for levelId ${parsed.levelId}`)
const geo = levelGeometry[meta.levelName]
if (!geo) throw new Error(`no LevelGeometry for levelName ${meta.levelName}`)

const sim = new Simulation({ parsed, geometry: geo })
const lengthMs = parsed.results[0]?.lengthMs ?? 0

type Frame = {
  ms: number
  entities: {
    id: number
    x: number
    y: number
    vx: number
    vy: number
    facing: number
    posture: string
    alive: boolean
    damagePct: number
    inHitstun: boolean
    heldWeapon: string
  }[]
  items: { x: number; y: number; weapon: string; available: boolean }[]
}

const frames: Frame[] = []
let currentFrame: Frame | null = null
for (const t of sim.ticks()) {
  if (currentFrame === null || currentFrame.ms !== t.ms) {
    currentFrame = { ms: t.ms, entities: [], items: sim.itemSlotSnapshots(t.ms) }
    frames.push(currentFrame)
  }
  currentFrame.entities.push({
    id: t.entity.id,
    x: t.entity.pos.x,
    y: t.entity.pos.y,
    vx: t.entity.vel.x,
    vy: t.entity.vel.y,
    facing: t.entity.facing,
    posture: t.entity.posture,
    alive: t.entity.alive,
    damagePct: t.entity.damagePct,
    inHitstun: t.ms < t.entity.hitstunUntilMs,
    // The weaponChangesByEntity timeline is the authoritative source but we
    // reconstruct per-tick held weapon from it here since EntityState
    // doesn't carry it directly.
    heldWeapon: '',
  })
}

// Backfill heldWeapon from the change timeline.
const timeline = sim.weaponChangesByEntity()
for (const frame of frames) {
  for (const ent of frame.entities) {
    const tl = timeline.get(ent.id) ?? []
    let weapon = 'Base'
    for (const change of tl) {
      if (change.ms > frame.ms) break
      weapon = change.weapon
    }
    ent.heldWeapon = weapon
  }
}

const attacks = sim.attackAttempts().map((a) => ({
  tick: a.tick,
  ms: a.ms,
  entityId: a.entityId,
  button: a.button,
  direction: a.direction,
  posture: a.posture,
  powerId: a.powerId,
  powerName: a.powerName,
}))

const landed = sim.landedHitEvents().map((h) => ({
  attackerId: h.attackerId,
  defenderId: h.defenderId,
  ms: h.ms,
  powerId: h.powerId,
  powerName: getPowerById(h.powerId)?.powerName ?? null,
  baseDamage: h.baseDamage,
}))

const entitiesMeta = parsed.entities.map((e) => {
  const heroId = e.playerData.heroes[0]?.heroId
  const legend = heroId !== undefined ? getLegendById(heroId) : undefined
  return {
    id: e.id,
    name: e.name,
    team: e.team,
    heroId: heroId ?? null,
    legend: legend?.heroName ?? null,
    weaponOne: legend?.weaponOne ?? null,
    weaponTwo: legend?.weaponTwo ?? null,
    strength: legend?.strength ?? 0,
    weight: legend?.weight ?? 0,
  }
})

const output = {
  source: basename(replayPath),
  level: { name: meta.levelName, displayName: meta.displayName },
  geometry: geo,
  lengthMs,
  entitiesMeta,
  frames,
  attacks,
  landed,
}

writeFileSync(outPath, JSON.stringify(output))
console.log(`wrote ${outPath}  (${frames.length} frames, ${attacks.length} attempts, ${landed.length} landed hits)`)

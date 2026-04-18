import type { LevelGeometry } from '@brawltome/game-data'
import type { ParsedReplay } from '@brawltome/replay-format'
import { classifyPosture } from './collision'
import { InputDriver } from './input-driver'
import { TICK_MS, msToTick, tickToMs } from './tick'
import type { EntityState, EntityTick, Posture } from './types'

export type SimInput = {
  parsed: ParsedReplay
  geometry: LevelGeometry
}

export type PostureTotals = {
  entityId: number
  air: number
  ground: number
  wall: number
  totalTicks: number
}

// Per-entity position samples over the match. v1 walks entities from their
// spawn respawn points with zero movement (physics pass lands in a follow-up
// commit); this is the scaffold that plugs every piece together: input
// driver, level geometry, tick loop, per-tick posture classification.
export class Simulation {
  private readonly endTick: number
  private readonly entities = new Map<number, EntityState>()
  private readonly driver: InputDriver
  private readonly geometry: LevelGeometry

  constructor(input: SimInput) {
    this.driver = new InputDriver(input.parsed.inputs)
    this.geometry = input.geometry
    const lengthMs = input.parsed.results[0]?.lengthMs ?? 0
    this.endTick = msToTick(lengthMs)
    const respawns = input.geometry.respawns
    input.parsed.entities.forEach((e, i) => {
      const spawn = respawns[i % Math.max(respawns.length, 1)] ?? { x: 0, y: 0 }
      this.entities.set(e.id, {
        id: e.id,
        team: e.team,
        pos: { x: spawn.x, y: spawn.y },
        vel: { x: 0, y: 0 },
        facing: 1,
        posture: 'air',
        alive: true,
      })
    })
  }

  /** Runs every tick and emits per-entity posture samples. */
  *ticks(): Generator<EntityTick> {
    for (let tick = 0; tick <= this.endTick; tick++) {
      const ms = tickToMs(tick)
      for (const entity of this.entities.values()) {
        if (!entity.alive) continue
        this.driver.flagsAt(entity.id, ms) // pumped even when ignored so ms cursors stay in sync
        entity.posture = classifyPosture(entity.pos, this.geometry)
        yield { tick, ms, entity }
      }
    }
  }

  /** Accumulates posture time per entity across the whole match. */
  postureTotals(): PostureTotals[] {
    const acc = new Map<number, { air: number; ground: number; wall: number; total: number }>()
    for (const { entity } of this.ticks()) {
      let bucket = acc.get(entity.id)
      if (!bucket) {
        bucket = { air: 0, ground: 0, wall: 0, total: 0 }
        acc.set(entity.id, bucket)
      }
      bucket[entity.posture as Posture] += 1
      bucket.total += 1
    }
    return [...acc.entries()].map(([entityId, b]) => ({
      entityId,
      air: b.air * TICK_MS,
      ground: b.ground * TICK_MS,
      wall: b.wall * TICK_MS,
      totalTicks: b.total,
    }))
  }
}

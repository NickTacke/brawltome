import type { LevelGeometry } from '@brawltome/game-data'
import type { ParsedReplay } from '@brawltome/replay-format'
import { InputDriver } from './input-driver'
import { DEFAULT_PHYSICS, type EntityPhysState, makePhysState, stepEntity } from './physics'
import { TICK_MS, msToTick, tickToMs } from './tick'
import type { EntityState, EntityTick, PhysicsParams, Posture } from './types'

export type SimInput = {
  parsed: ParsedReplay
  geometry: LevelGeometry
  physics?: PhysicsParams
}

export type PostureTotals = {
  entityId: number
  air: number
  ground: number
  wall: number
  totalTicks: number
}

// Per-entity position samples over the match. Each tick:
//  1. Read input flags from the cursor for this ms.
//  2. Apply horizontal input + gravity + jump.
//  3. Integrate velocity into position.
//  4. Resolve ground/wall collisions against the level geometry.
//  5. Update posture from the resolved state.
export class Simulation {
  private readonly endTick: number
  private readonly entities = new Map<number, EntityState>()
  private readonly physState = new Map<number, EntityPhysState>()
  private readonly driver: InputDriver
  private readonly geometry: LevelGeometry
  private readonly physicsParams: PhysicsParams

  constructor(input: SimInput) {
    this.driver = new InputDriver(input.parsed.inputs)
    this.geometry = input.geometry
    this.physicsParams = input.physics ?? DEFAULT_PHYSICS
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
      this.physState.set(e.id, makePhysState())
    })
  }

  *ticks(): Generator<EntityTick> {
    for (let tick = 0; tick <= this.endTick; tick++) {
      const ms = tickToMs(tick)
      for (const entity of this.entities.values()) {
        if (!entity.alive) continue
        const flags = this.driver.flagsAt(entity.id, ms)
        const phys = this.physState.get(entity.id)
        if (!phys) continue
        const next = stepEntity(entity, flags, phys, this.geometry, this.physicsParams)
        this.physState.set(entity.id, next)
        yield { tick, ms, entity }
      }
    }
  }

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

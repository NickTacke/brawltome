import { getLegendById, getPowerById, type LevelGeometry } from '@brawltome/game-data'
import { InputFlag, type ParsedReplay } from '@brawltome/replay-format'
import { detectAttackAttempts } from './attack-events'
import { type AttackWindow, type LandedHit, checkWindow, planAttackWindows } from './hit-detection'
import { InputDriver } from './input-driver'
import {
  advanceItemSlots,
  consumeSlot,
  findPickupSlot,
  type ItemSlotState,
  makeItemSlots,
} from './item-sim'
import {
  DEFAULT_PHYSICS,
  type EntityPhysState,
  checkKillAndRespawn,
  isOutOfBounds,
  makePhysState,
  stepEntity,
} from './physics'
import { TICK_MS, msToTick, tickToMs } from './tick'
import type {
  AttackAttempt,
  EntityState,
  EntityTick,
  PhysicsParams,
  Posture,
  Vec2,
} from './types'

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
  private readonly respawnPoints = new Map<number, Vec2>()
  private readonly attacks: AttackAttempt[] = []
  // Per-entity legend internal name, used by the attack resolver when
  // selecting between legend-specific signature powers. Not all entities
  // will have a known legend (bots, corrupt replays); those stay undefined
  // and the resolver falls back to the base signature.
  private readonly legendName = new Map<number, string>()
  // Union of every entity's weaponOne + weaponTwo (de-duplicated, insertion-
  // order). Slots cycle through this pool. 'Base' is implicit - an unarmed
  // state is always reachable by dropping or respawning.
  private readonly weaponPool: string[] = []
  // Set of weapons this entity is willing to pick up (= their own
  // weaponOne/weaponTwo). Mirrors the observed behaviour that players
  // avoid borrowed weapons because those disable signatures.
  private readonly ownedWeapons = new Map<number, Set<string>>()
  private readonly itemSlots: ItemSlotState[]
  // In-hand weapon per entity, as a power-name prefix ('Base' for unarmed).
  // Defaults to 'Base' on spawn; updated by pickup/drop in the tick loop.
  private readonly heldWeapon = new Map<number, string>()
  // Debug counters for the diagnostic harness; not part of the product API.
  private readonly pickupCounts = new Map<number, number>()
  private readonly weaponTimeMs = new Map<number, Map<string, number>>()
  // Active attack hitbox windows. Added when an AttackAttempt resolves to
  // a Power with a parseable castTime; pruned once the window's end has
  // elapsed. Per-(attacker,defender,power) cooldowns live in a separate
  // map keyed by a joined string.
  private readonly activeWindows: AttackWindow[] = []
  private readonly hitCooldowns = new Map<string, number>()
  private readonly landedHits: LandedHit[] = []
  // Compact per-entity timeline of weapon-in-hand changes. Each entry is
  // "from ms onward, the entity held `weapon`". Starts with an implicit
  // 'Base' at ms=0 (spawn); a change event is recorded only when heldWeapon
  // differs from the prior entry.
  private readonly weaponChangeTimeline = new Map<number, { ms: number; weapon: string }[]>()
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
    const weaponSet = new Set<string>()
    input.parsed.entities.forEach((e, i) => {
      const spawn = respawns[i % Math.max(respawns.length, 1)] ?? { x: 0, y: 0 }
      this.respawnPoints.set(e.id, { x: spawn.x, y: spawn.y })
      const heroId = e.playerData.heroes[0]?.heroId
      const legend = heroId !== undefined ? getLegendById(heroId) : undefined
      if (legend?.heroName) this.legendName.set(e.id, legend.heroName)
      const own = new Set<string>()
      if (legend?.weaponOne) {
        weaponSet.add(legend.weaponOne)
        own.add(legend.weaponOne)
      }
      if (legend?.weaponTwo) {
        weaponSet.add(legend.weaponTwo)
        own.add(legend.weaponTwo)
      }
      this.ownedWeapons.set(e.id, own)
      this.heldWeapon.set(e.id, 'Base')
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
    this.weaponPool = [...weaponSet]
    this.itemSlots = makeItemSlots(this.geometry, this.weaponPool.length)
  }

  *ticks(): Generator<EntityTick> {
    for (let tick = 0; tick <= this.endTick; tick++) {
      const ms = tickToMs(tick)
      advanceItemSlots(this.itemSlots, ms, this.weaponPool.length)
      // Hit detection: walk every live attack window and check overlap
      // against opponents. Prune spent windows in-place.
      for (let i = this.activeWindows.length - 1; i >= 0; i--) {
        const w = this.activeWindows[i]
        if (ms > w.activeEndMs) {
          this.activeWindows.splice(i, 1)
          continue
        }
        const attacker = this.entities.get(w.attackerId)
        if (!attacker || !attacker.alive) continue
        const opponents: EntityState[] = []
        for (const e of this.entities.values()) {
          if (e.id !== w.attackerId && e.team !== attacker.team) opponents.push(e)
        }
        const hits = checkWindow(w, ms, attacker, opponents, this.hitCooldowns)
        if (hits.length > 0) this.landedHits.push(...hits)
      }
      for (const entity of this.entities.values()) {
        if (!entity.alive) continue
        const flags = this.driver.flagsAt(entity.id, ms)
        const phys = this.physState.get(entity.id)
        if (!phys) continue
        let held = this.heldWeapon.get(entity.id) ?? 'Base'
        const priorHeld = held

        // Pickup: overlap-based. Only unarmed entities can pick up, and only
        // weapons they own (their legend's weaponOne/weaponTwo).
        if (held === 'Base' && this.weaponPool.length > 0) {
          const owned = this.ownedWeapons.get(entity.id) ?? new Set<string>()
          const slotIdx = findPickupSlot(entity.pos, this.itemSlots, this.weaponPool, owned)
          if (slotIdx !== null) {
            held = consumeSlot(this.itemSlots[slotIdx], ms, this.weaponPool)
            this.heldWeapon.set(entity.id, held)
            this.pickupCounts.set(entity.id, (this.pickupCounts.get(entity.id) ?? 0) + 1)
          }
        }

        // Dropping on PickUpThrow over-unarms entities: the input bit
        // doubles as pickup, grab, short-press drop, and long-press throw,
        // but the stats JSON shows real throws happen a handful of times
        // per match. Short-press drops also stay recoverable for ~1s, so
        // players usually re-pick their own weapon. Until we can distinguish
        // the intents, treating armed state as persistent until death is a
        // closer approximation than dropping on every PickUpThrow press.

        if (held !== priorHeld) {
          const tl = this.weaponChangeTimeline.get(entity.id) ?? []
          tl.push({ ms, weapon: held })
          this.weaponChangeTimeline.set(entity.id, tl)
        }
        // Weapon-held-time accumulator for diagnostics.
        const bucket = this.weaponTimeMs.get(entity.id) ?? new Map<string, number>()
        bucket.set(held, (bucket.get(held) ?? 0) + TICK_MS)
        this.weaponTimeMs.set(entity.id, bucket)

        // Detect attack-button edges before stepEntity runs, so posture is
        // the state the entity had when the press "happened", not the state
        // after the tick's physics resolved. The resolver sees the entity's
        // actual in-hand weapon.
        const attempts = detectAttackAttempts({
          tick,
          ms,
          entityId: entity.id,
          flags,
          prevFlags: phys.prevFlags,
          posture: entity.posture,
          weapon: held,
          legend: this.legendName.get(entity.id),
        })
        if (attempts.length > 0) {
          this.attacks.push(...attempts)
          // Each resolved attempt plants a hit-detection window. Powers
          // with empty castTime yield null and are skipped.
          for (const a of attempts) {
            if (a.powerId === null) continue
            const pw = getPowerById(a.powerId)
            if (!pw) continue
            for (const win of planAttackWindows(pw, a.entityId, a.ms)) {
              this.activeWindows.push(win)
            }
          }
        }

        const next = stepEntity(entity, flags, phys, this.geometry, this.physicsParams)
        const respawn = this.respawnPoints.get(entity.id) ?? { x: 0, y: 0 }
        // If the kill check is about to fire, the entity loses its weapon.
        // Check before the respawn mutates position so we don't need to
        // inspect the return value.
        if (held !== 'Base' && isOutOfBounds(entity.pos, this.geometry)) {
          this.heldWeapon.set(entity.id, 'Base')
          const tl = this.weaponChangeTimeline.get(entity.id) ?? []
          tl.push({ ms, weapon: 'Base' })
          this.weaponChangeTimeline.set(entity.id, tl)
        }
        const after = checkKillAndRespawn(entity, this.geometry, respawn, next)
        this.physState.set(entity.id, after)
        yield { tick, ms, entity }
      }
    }
  }

  // Every edge-triggered attack-button press in match order. Computed as a
  // side effect of iterating ticks(); if the caller has not yet drained the
  // tick generator, this returns whatever has accumulated so far.
  attackAttempts(): readonly AttackAttempt[] {
    return this.attacks
  }

  // Per-entity weapon-pickup count across the match. Diagnostic-only.
  pickupCountsByEntity(): ReadonlyMap<number, number> {
    return this.pickupCounts
  }

  // Per-entity, per-weapon ms-held totals. Diagnostic-only.
  weaponTimeByEntity(): ReadonlyMap<number, ReadonlyMap<string, number>> {
    return this.weaponTimeMs
  }

  // Per-entity weapon-change timeline. Each inner array is sorted by ms
  // ascending; an implicit { ms: 0, weapon: 'Base' } precedes the first
  // entry. Diagnostic-only.
  weaponChangesByEntity(): ReadonlyMap<number, readonly { ms: number; weapon: string }[]> {
    return this.weaponChangeTimeline
  }

  // Every landed hit the detector recorded, in match order.
  landedHitEvents(): readonly LandedHit[] {
    return this.landedHits
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

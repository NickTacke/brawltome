import { type LevelGeometry, getLegendById, getPowerById } from '@brawltome/game-data'
import { InputFlag, type ParsedReplay } from '@brawltome/replay-format'
import { detectAttackAttempts } from './attack-events'
import { type AttackWindow, type LandedHit, checkWindow, detectClash, planAttackWindows } from './hit-detection'
import { InputDriver } from './input-driver'
import { type ItemSlotState, advanceItemSlots, consumeSlot, findPickupSlot, makeItemSlots } from './item-sim'
import { computeKnockback } from './knockback'
import {
  DEFAULT_PHYSICS,
  type EntityPhysState,
  checkKillAndRespawn,
  isOutOfBounds,
  makePhysState,
  stepEntity,
} from './physics'
import { TICK_MS, msToTick, tickToMs } from './tick'
import type { AttackAttempt, EntityState, EntityTick, PhysicsParams, Posture, Vec2 } from './types'

// Brawlhalla's hardcoded pre-match countdown length. During this window
// the game engine gates its entire update loop (§_-H5M§.as pregame check
// `_loc4_ < 6000`), freezing player physics and dropping any buffered
// input presses. Tracked as a sim-wide constant so the item-pickup code
// can line up to the same gate.
export const COUNTDOWN_MS = 6000

// Dodge invulnerability window, in ms. Approximately 22 frames at 60Hz,
// close to the community-documented 20-25 frame range for ground/air
// dodges in BH. Not yet split between ground and air variants.
const DODGE_INVULN_MS = 370

// Chase-dodge chain window: after landing a hit the attacker keeps their
// chase tokens alive for this long. 600ms (~36 frames) is a starting
// guess pending a tighter measurement; the tokens also reset when the
// attacker throws another attack (chain break).
const CHASE_WINDOW_MS = 600

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
  // Cached per-entity strength and weight stats from their legend, used by
  // the knockback formula (attacker strength scales outgoing impulse,
  // defender weight reduces incoming).
  private readonly entityStrength = new Map<number, number>()
  private readonly entityWeight = new Map<number, number>()
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
    // Respawn points in the XML alternate team sides: index 0 is the
    // outermost left-side spawn, 1 is the outermost right, 2 is the next
    // left-side, etc. BH's 2v2 matches spawn players on the inner
    // respawns rather than the stage edges; for a 4-entity match we skip
    // the outermost pair and use indices 2..5. 1v1 stays at 0,1. Larger
    // player counts fall back to using everything.
    const startOffset = input.parsed.entities.length === 4 && respawns.length >= 6 ? 2 : 0
    const teamCursor = new Map<number, number>()
    for (const e of input.parsed.entities) {
      // Team 1 (or first-seen team) takes even indices, team 2 odd.
      const parity = e.team === 1 ? 0 : e.team === 2 ? 1 : e.team % 2
      const nth = teamCursor.get(e.team) ?? 0
      teamCursor.set(e.team, nth + 1)
      const idx = (startOffset + parity + nth * 2) % Math.max(respawns.length, 1)
      const spawn = respawns[idx] ?? { x: 0, y: 0 }
      this.respawnPoints.set(e.id, { x: spawn.x, y: spawn.y })
      const heroId = e.playerData.heroes[0]?.heroId
      const legend = heroId !== undefined ? getLegendById(heroId) : undefined
      if (legend?.heroName) this.legendName.set(e.id, legend.heroName)
      if (legend) {
        this.entityStrength.set(e.id, legend.strength)
        this.entityWeight.set(e.id, legend.weight)
      }
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
        damagePct: 0,
        hitstunUntilMs: 0,
        invulnUntilMs: 0,
        chaseDodgeTokens: 0,
        chaseWindowUntilMs: 0,
      })
      this.physState.set(e.id, makePhysState())
    }
    this.weaponPool = [...weaponSet]
    this.itemSlots = makeItemSlots(this.geometry, this.weaponPool.length)
  }

  *ticks(): Generator<EntityTick> {
    for (let tick = 0; tick <= this.endTick; tick++) {
      const ms = tickToMs(tick)
      // Brawlhalla has a hardcoded 6000 ms pre-match countdown during which
      // the engine skips its whole update loop: entity physics, input
      // processing, hit detection, and item timers are all gated by the
      // `_loc4_ < 6000` check in §_-H5M§.as. During this window the
      // replay's own input stream may record a few early presses (keys
      // buffered by the player pre-match) but the game drops them. Our
      // sim mirrors that behaviour by yielding frozen entities and
      // skipping every subsystem until the countdown elapses.
      if (ms < COUNTDOWN_MS) {
        for (const entity of this.entities.values()) {
          yield { tick, ms, entity }
        }
        continue
      }
      advanceItemSlots(this.itemSlots, ms, this.weaponPool.length)

      // Prune spent hit-detection windows first.
      for (let i = this.activeWindows.length - 1; i >= 0; i--) {
        if (ms > this.activeWindows[i].activeEndMs) this.activeWindows.splice(i, 1)
      }

      // Clash pass: any two cross-team windows whose hitboxes overlap
      // on this tick cancel each other and apply ClashLight / ClashHeavy
      // knockback + hitstun to both attackers (no damage). After this
      // runs, the clashed windows are removed so the normal hit check
      // below doesn't also register them as landed hits.
      const clashed = new Set<AttackWindow>()
      for (let i = 0; i < this.activeWindows.length; i++) {
        const a = this.activeWindows[i]
        if (clashed.has(a)) continue
        if (ms < a.activeStartMs) continue
        const aAttacker = this.entities.get(a.attackerId)
        if (!aAttacker || !aAttacker.alive) continue
        for (let j = i + 1; j < this.activeWindows.length; j++) {
          const b = this.activeWindows[j]
          if (clashed.has(b)) continue
          if (ms < b.activeStartMs) continue
          const bAttacker = this.entities.get(b.attackerId)
          if (!bAttacker || !bAttacker.alive) continue
          const clashPower = detectClash(a, aAttacker, b, bAttacker)
          if (!clashPower) continue
          // Apply clash-as-hit to each entity, using the OTHER entity as
          // the attacker source for the knockback direction.
          for (const [atk, def, win] of [
            [bAttacker, aAttacker, a],
            [aAttacker, bAttacker, b],
          ] as const) {
            const kb = computeKnockback({
              power: clashPower,
              hitboxIdx: 0,
              attacker: atk,
              defender: def,
              attackerStrength: this.entityStrength.get(atk.id) ?? 5,
              defenderWeight: this.entityWeight.get(def.id) ?? 5,
            })
            def.vel.x = kb.vx
            def.vel.y = kb.vy
            def.posture = 'air'
            def.hitstunUntilMs = ms + kb.hitstunMs
            def.damagePct = Math.min(700, def.damagePct + (clashPower.baseDamage[0] ?? 0))
            this.landedHits.push({
              attackerId: atk.id,
              defenderId: def.id,
              ms,
              powerId: clashPower.powerId,
              baseDamage: clashPower.baseDamage[0] ?? 0,
            })
          }
          clashed.add(a)
          clashed.add(b)
          break
        }
      }
      for (const w of clashed) {
        const idx = this.activeWindows.indexOf(w)
        if (idx >= 0) this.activeWindows.splice(idx, 1)
      }

      // Normal hit detection: walk remaining live windows and check overlap
      // against opponents' body boxes.
      for (let i = this.activeWindows.length - 1; i >= 0; i--) {
        const w = this.activeWindows[i]
        const attacker = this.entities.get(w.attackerId)
        if (!attacker || !attacker.alive) continue
        const opponents: EntityState[] = []
        for (const e of this.entities.values()) {
          if (e.id !== w.attackerId && e.team !== attacker.team) opponents.push(e)
        }
        const hits = checkWindow(w, ms, attacker, opponents, this.hitCooldowns)
        if (hits.length === 0) continue
        this.landedHits.push(...hits)
        // Apply knockback + hitstun + damage accumulator to each defender,
        // and grant chase-dodge tokens to the attacker (2 on ground, 1 in
        // the air). The window refreshes on every landed hit so a combo
        // keeps tokens alive as long as hits keep connecting.
        const chaseTokens = attacker.posture === 'ground' ? 2 : 1
        attacker.chaseDodgeTokens = chaseTokens
        attacker.chaseWindowUntilMs = ms + CHASE_WINDOW_MS
        for (const h of hits) {
          const defender = this.entities.get(h.defenderId)
          if (!defender) continue
          const kb = computeKnockback({
            power: w.power,
            hitboxIdx: w.hitboxIdx,
            attacker,
            defender,
            attackerStrength: this.entityStrength.get(w.attackerId) ?? 5,
            defenderWeight: this.entityWeight.get(h.defenderId) ?? 5,
          })
          defender.vel.x = kb.vx
          defender.vel.y = kb.vy
          defender.posture = 'air'
          defender.hitstunUntilMs = ms + kb.hitstunMs
          defender.damagePct = Math.min(700, defender.damagePct + h.baseDamage)
        }
      }
      for (const entity of this.entities.values()) {
        if (!entity.alive) continue
        const rawFlags = this.driver.flagsAt(entity.id, ms)
        const phys = this.physState.get(entity.id)
        if (!phys) continue
        // During hitstun the entity can't initiate attacks or pickups, but
        // BH explicitly lets the DodgeDash input through so the defender
        // can chase-dodge out of hitstun (§_-Z1H§.as:7490 `§_-E1f§`).
        // Everything else is zero-flagged; the entity's carry-over
        // momentum handles positional drift.
        const inHitstun = ms < entity.hitstunUntilMs
        const flags = inHitstun ? rawFlags & InputFlag.DodgeDash : rawFlags
        let held = this.heldWeapon.get(entity.id) ?? 'Base'
        const priorHeld = held

        // Edge-detected attack press breaks the chase-dodge chain: throwing
        // another attack forfeits any remaining tokens.
        const lightEdge = (flags & InputFlag.Light) !== 0 && (phys.prevFlags & InputFlag.Light) === 0
        const heavyEdge = (flags & InputFlag.Heavy) !== 0 && (phys.prevFlags & InputFlag.Heavy) === 0
        if (lightEdge || heavyEdge) {
          entity.chaseDodgeTokens = 0
          entity.chaseWindowUntilMs = 0
        }

        // Dodge press grants invuln. If the entity has chase tokens within
        // their active window, consume one (first post-hit dodge is the
        // "chase dodge"; second is also legal while grounded, optionally
        // a gravity-cancel - we don't model that variant yet).
        const dodgeEdge = (flags & InputFlag.DodgeDash) !== 0 && (phys.prevFlags & InputFlag.DodgeDash) === 0
        if (dodgeEdge) {
          entity.invulnUntilMs = ms + DODGE_INVULN_MS
          if (entity.chaseDodgeTokens > 0 && ms < entity.chaseWindowUntilMs) {
            entity.chaseDodgeTokens -= 1
          }
        }
        if (ms >= entity.chaseWindowUntilMs) {
          entity.chaseDodgeTokens = 0
        }

        // Pickup: the entity must PRESS PickUpThrow while unarmed and over
        // an available item slot. Walking over a weapon does not auto-grab
        // it in BH; the player has to intent-press the pickup button.
        // Edge-triggered so holding the button through a slot doesn't spam
        // re-picks on subsequent ticks. findPickupSlot also gates on the
        // match-start countdown.
        const pickupNow = (flags & InputFlag.PickUpThrow) !== 0
        const pickupPrev = (phys.prevFlags & InputFlag.PickUpThrow) !== 0
        if (pickupNow && !pickupPrev && held === 'Base' && this.weaponPool.length > 0) {
          const owned = this.ownedWeapons.get(entity.id) ?? new Set<string>()
          const slotIdx = findPickupSlot(entity.pos, this.itemSlots, this.weaponPool, owned, ms)
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

        const next = stepEntity(entity, flags, phys, this.geometry, this.physicsParams, ms)
        const respawn = this.respawnPoints.get(entity.id) ?? { x: 0, y: 0 }
        // If the kill check is about to fire, the entity loses its weapon.
        // Check before the respawn mutates position so we don't need to
        // inspect the return value.
        const willDie = isOutOfBounds(entity.pos, this.geometry)
        if (willDie) {
          if (held !== 'Base') {
            this.heldWeapon.set(entity.id, 'Base')
            const tl = this.weaponChangeTimeline.get(entity.id) ?? []
            tl.push({ ms, weapon: 'Base' })
            this.weaponChangeTimeline.set(entity.id, tl)
          }
          // Reset per-entity runtime state on death; otherwise the next
          // life inherits stale damage scaling, hitstun lockout, or
          // phantom chase-dodge tokens.
          entity.damagePct = 0
          entity.hitstunUntilMs = 0
          entity.invulnUntilMs = 0
          entity.chaseDodgeTokens = 0
          entity.chaseWindowUntilMs = 0
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

  // Snapshot of each item slot's landed position + current availability
  // + current weapon, for the dev viewer. Landed position is the platform
  // level the item rests on after falling from its XML air spawn.
  itemSlotSnapshots(nowMs: number): { x: number; y: number; weapon: string; available: boolean }[] {
    return this.itemSlots.map((s) => ({
      x: s.landedPos.x,
      y: s.landedPos.y,
      weapon: this.weaponPool[s.weaponIndex] ?? 'Base',
      available: s.status === 'available' && nowMs >= 6000,
    }))
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

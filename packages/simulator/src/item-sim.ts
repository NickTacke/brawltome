import type { ItemSpawn, LevelGeometry } from '@brawltome/game-data'
import type { Vec2 } from './types'

// Horizontal and vertical pickup box around the item's LANDED position on
// a platform. The item sits on the collision line (feet-level for the
// player); entities standing on the same platform overlap vertically
// within ~80 units (their body extends upward). 100 gives a bit of room
// for players arcing through the space.
const PICKUP_RANGE_X = 120
const PICKUP_RANGE_Y = 100

// Brawlhalla's pregame countdown is a hardcoded 6 s (§_-H5M§.as). Inputs
// are gated, entity physics paused, and items are still mid-fall from
// their air spawns to their landing platforms, so nothing is pickable.
// Matches sim.ts COUNTDOWN_MS; kept as a separate constant here only to
// avoid a circular import between the physics/item sub-modules.
const MATCH_START_DELAY_MS = 6000

// Time the slot is unavailable after an item is picked up, in ms. Real
// Brawlhalla cycles between ~5s and ~10s depending on the spawn-rate rule
// set.
const RESPAWN_MS = 6000

// Running state of one item slot defined in LevelGeometry.itemSpawns. The
// slot owns the weapon currently sitting on it (or that will appear after
// respawn) via `weaponIndex` into the match's weapon pool. `landedPos` is
// where the item physically sits after falling from the XML's air spawn
// position to the nearest platform below; this is the position pickup
// overlap checks against, not the spawn coordinate.
export type ItemSlotState = {
  slot: ItemSpawn
  weaponIndex: number
  landedPos: Vec2
  status: 'available' | 'respawning'
  respawnAtMs: number
}

// Finds the highest collision line at-or-below (x, y) whose x-span covers
// `x`. Includes soft platforms because items in BH land on them too.
// Returns null if nothing is below (item would fall into the pit).
function findFloorBelow(x: number, y: number, geometry: LevelGeometry): number | null {
  let best: number | null = null
  for (const c of geometry.collisions) {
    if (c.y1 !== c.y2) continue
    if (c.kind !== 'hard' && c.kind !== 'no_slide' && c.kind !== 'soft') continue
    if (x < Math.min(c.x1, c.x2) || x > Math.max(c.x1, c.x2)) continue
    if (c.y1 < y) continue
    if (best === null || c.y1 < best) best = c.y1
  }
  return best
}

// Initial respawn offset for rolling ItemSpawn slots. Per §_-42t§.as the
// rolling cycle doesn't run at match start - only init/teamInit items are
// present after countdown. Rolling slots cycle in at their normal cadence
// from match-start + one respawn interval. 8s lines up with the ~6-10s
// interval the engine uses for most game modes.
const ROLLING_INITIAL_DELAY_MS = 8000

export function makeItemSlots(geometry: LevelGeometry, weaponPoolSize: number): ItemSlotState[] {
  if (weaponPoolSize === 0) return []
  return geometry.itemSpawns.map((slot, i) => {
    const floorY = findFloorBelow(slot.x, slot.y, geometry)
    const landedPos: Vec2 = floorY !== null ? { x: slot.x, y: floorY } : { x: slot.x, y: slot.y }
    // init and teamInit spawn with an item already at match start (drops
    // during countdown). rolling areas stay empty until the first respawn
    // cycle fires after the countdown.
    const isRolling = slot.kind === 'rolling'
    return {
      slot,
      weaponIndex: i % weaponPoolSize,
      landedPos,
      status: (isRolling ? 'respawning' : 'available') as 'available' | 'respawning',
      respawnAtMs: isRolling ? MATCH_START_DELAY_MS + ROLLING_INITIAL_DELAY_MS : 0,
    }
  })
}

// True if `pos` is inside the pickup box around the item's landed position.
// Rolling slots have a declared area (w/h); init slots are points (w=h=0)
// so we fall back to a fixed range around the landed position.
function isWithinPickupRange(pos: Vec2, state: ItemSlotState): boolean {
  const halfW = Math.max(state.slot.w / 2, PICKUP_RANGE_X)
  const halfH = Math.max(state.slot.h / 2, PICKUP_RANGE_Y)
  return Math.abs(pos.x - state.landedPos.x) <= halfW && Math.abs(pos.y - state.landedPos.y) <= halfH
}

// Returns the index into `slots` of the first available slot the entity is
// overlapping AND whose weapon the entity is willing to wield, or null.
// `allowedWeapons` filters by ownership: in real Brawlhalla matches players
// overwhelmingly pick up their own weaponOne/weaponTwo because borrowed
// weapons disable signatures. Pass an empty set to allow any weapon.
export function findPickupSlot(
  pos: Vec2,
  slots: ItemSlotState[],
  weaponPool: readonly string[],
  allowedWeapons: ReadonlySet<string>,
  nowMs = Number.POSITIVE_INFINITY,
): number | null {
  if (nowMs < MATCH_START_DELAY_MS) return null
  const anyAllowed = allowedWeapons.size === 0
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s.status !== 'available') continue
    if (!isWithinPickupRange(pos, s)) continue
    if (!anyAllowed) {
      const weapon = weaponPool[s.weaponIndex]
      if (!weapon || !allowedWeapons.has(weapon)) continue
    }
    return i
  }
  return null
}

// Tick the respawn timer for every slot. Slots whose respawn deadline has
// passed flip back to 'available' and advance their weaponIndex so the
// next spawn at the same slot has a different weapon. This roughly matches
// Brawlhalla's variety guarantee and keeps every weapon in circulation even
// when the pool is larger than the owned-weapon set of any single player.
export function advanceItemSlots(slots: ItemSlotState[], nowMs: number, weaponPoolSize: number): void {
  if (weaponPoolSize === 0) return
  for (const s of slots) {
    if (s.status === 'respawning' && nowMs >= s.respawnAtMs) {
      s.status = 'available'
      s.weaponIndex = (s.weaponIndex + 1) % weaponPoolSize
    }
  }
}

// Mark a slot as just picked up: goes to 'respawning' with the timer
// starting from `nowMs`. Returns the weapon that was picked up so the
// caller can set it on the entity.
export function consumeSlot(slot: ItemSlotState, nowMs: number, weaponPool: readonly string[]): string {
  slot.status = 'respawning'
  slot.respawnAtMs = nowMs + RESPAWN_MS
  return weaponPool[slot.weaponIndex] ?? 'Base'
}

export const RESPAWN_MS_DEFAULT = RESPAWN_MS
export const MATCH_START_DELAY_MS_DEFAULT = MATCH_START_DELAY_MS

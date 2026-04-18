import type { ItemSpawn, LevelGeometry } from '@brawltome/game-data'
import type { Vec2 } from './types'

// Horizontal and vertical range within which an entity is considered to
// be overlapping an item slot for pickup purposes. The Y range is tight
// enough that entities need to be at roughly platform level to grab an
// item - high init/teamInit slots that spawn in the air aren't reachable
// until the item falls onto a platform, which the sim approximates by
// making slots available only after MATCH_START_DELAY_MS has elapsed.
const PICKUP_RANGE_X = 200
const PICKUP_RANGE_Y = 200

// Brawlhalla has a ~2.5-3s countdown at match start during which inputs
// are locked and items finish falling to their landing positions. Before
// this elapses no pickups fire, matching the stats-dump observation that
// real first-pickup times sit in the 2.5-10s range (never 0ms).
const MATCH_START_DELAY_MS = 2500

// Time the slot is unavailable after an item is picked up, in ms. Real
// Brawlhalla cycles between ~5s and ~10s depending on the spawn-rate rule
// set.
const RESPAWN_MS = 6000

// Running state of one item slot defined in LevelGeometry.itemSpawns. The
// slot owns the weapon currently sitting on it (or that will appear after
// respawn) via `weaponIndex` into the match's weapon pool.
export type ItemSlotState = {
  slot: ItemSpawn
  weaponIndex: number
  // 'available' means pickable; 'respawning' means the slot is on cooldown
  // after a pickup and will flip back to 'available' at `respawnAtMs`.
  status: 'available' | 'respawning'
  respawnAtMs: number
}

export function makeItemSlots(geometry: LevelGeometry, weaponPoolSize: number): ItemSlotState[] {
  if (weaponPoolSize === 0) return []
  return geometry.itemSpawns.map((slot, i) => ({
    slot,
    // Round-robin initial assignment so nearby slots don't all start with
    // the same weapon. Further respawns advance the index locally per-slot.
    weaponIndex: i % weaponPoolSize,
    status: 'available',
    respawnAtMs: 0,
  }))
}

// True if `pos` is inside the pickup box around `slot`. Rolling slots have
// a declared area (w/h); init slots are points (w=h=0) so we fall back to
// a fixed range around the point.
function isWithinPickupRange(pos: Vec2, slot: ItemSpawn): boolean {
  const halfW = Math.max(slot.w / 2, PICKUP_RANGE_X)
  const halfH = Math.max(slot.h / 2, PICKUP_RANGE_Y)
  return Math.abs(pos.x - slot.x) <= halfW && Math.abs(pos.y - slot.y) <= halfH
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
    if (!isWithinPickupRange(pos, s.slot)) continue
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

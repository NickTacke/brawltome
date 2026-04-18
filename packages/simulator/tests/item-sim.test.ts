import { describe, expect, test } from 'bun:test'
import type { ItemSpawn, LevelGeometry } from '@brawltome/game-data'
import {
  RESPAWN_MS_DEFAULT,
  advanceItemSlots,
  consumeSlot,
  findPickupSlot,
  makeItemSlots,
} from '../src/item-sim'

function makeGeo(itemSpawns: ItemSpawn[]): LevelGeometry {
  return {
    levelName: 'T',
    assetDir: 'T',
    cameraBounds: null,
    spawnBotBounds: null,
    killBounds: { left: null, right: null, top: null, bottom: null },
    respawns: [],
    itemSpawns,
    collisions: [],
  }
}

describe('makeItemSlots', () => {
  test('assigns round-robin weapon indices across slots', () => {
    const geo = makeGeo([
      { kind: 'init', x: 0, y: 0, w: 0, h: 0 },
      { kind: 'init', x: 100, y: 0, w: 0, h: 0 },
      { kind: 'init', x: 200, y: 0, w: 0, h: 0 },
    ])
    const slots = makeItemSlots(geo, 2)
    expect(slots.map((s) => s.weaponIndex)).toEqual([0, 1, 0])
    expect(slots.every((s) => s.status === 'available')).toBe(true)
  })

  test('empty weapon pool yields zero slots even if geometry has item spawns', () => {
    const geo = makeGeo([{ kind: 'init', x: 0, y: 0, w: 0, h: 0 }])
    expect(makeItemSlots(geo, 0).length).toBe(0)
  })
})

describe('findPickupSlot', () => {
  const anyWeapon = new Set<string>()

  test('point-style init slot uses a fixed pickup radius', () => {
    const slots = makeItemSlots(
      makeGeo([{ kind: 'init', x: 500, y: 500, w: 0, h: 0 }]),
      1,
    )
    expect(findPickupSlot({ x: 500, y: 500 }, slots, ['Sword'], anyWeapon)).toBe(0)
    expect(findPickupSlot({ x: 570, y: 500 }, slots, ['Sword'], anyWeapon)).toBe(0)
    expect(findPickupSlot({ x: 1000, y: 500 }, slots, ['Sword'], anyWeapon)).toBeNull()
  })

  test('area-style rolling slot respects its declared W/H', () => {
    const slots = makeItemSlots(
      makeGeo([{ kind: 'rolling', x: 0, y: 0, w: 600, h: 40 }]),
      1,
    )
    expect(findPickupSlot({ x: 280, y: 0 }, slots, ['Sword'], anyWeapon)).toBe(0)
    expect(findPickupSlot({ x: 400, y: 0 }, slots, ['Sword'], anyWeapon)).toBeNull()
  })

  test('respawning slot is not pickable', () => {
    const slots = makeItemSlots(
      makeGeo([{ kind: 'init', x: 0, y: 0, w: 0, h: 0 }]),
      1,
    )
    consumeSlot(slots[0], 0, ['Sword'])
    expect(findPickupSlot({ x: 0, y: 0 }, slots, ['Sword'], anyWeapon)).toBeNull()
  })

  test('allowedWeapons filter skips slots holding unowned weapons', () => {
    const slots = makeItemSlots(
      makeGeo([
        { kind: 'init', x: 0, y: 0, w: 0, h: 0 },
        { kind: 'init', x: 0, y: 0, w: 0, h: 0 },
      ]),
      2,
    )
    // slot 0 -> weaponIndex 0 (Sword), slot 1 -> weaponIndex 1 (Bow).
    const pool = ['Sword', 'Bow']
    const vikingOwned = new Set(['Sword', 'Hammer'])
    // Position overlaps both slots; the player only accepts Sword.
    expect(findPickupSlot({ x: 0, y: 0 }, slots, pool, vikingOwned)).toBe(0)
    // After the Sword slot is consumed, only the Bow slot remains; Viking
    // walks past it.
    consumeSlot(slots[0], 0, pool)
    expect(findPickupSlot({ x: 0, y: 0 }, slots, pool, vikingOwned)).toBeNull()
  })
})

describe('consumeSlot + advanceItemSlots lifecycle', () => {
  test('consume flips to respawning with the right deadline', () => {
    const slots = makeItemSlots(
      makeGeo([{ kind: 'init', x: 0, y: 0, w: 0, h: 0 }]),
      1,
    )
    const picked = consumeSlot(slots[0], 1000, ['Sword'])
    expect(picked).toBe('Sword')
    expect(slots[0].status).toBe('respawning')
    expect(slots[0].respawnAtMs).toBe(1000 + RESPAWN_MS_DEFAULT)
  })

  test('advance re-enables the slot once past the deadline', () => {
    const slots = makeItemSlots(
      makeGeo([{ kind: 'init', x: 0, y: 0, w: 0, h: 0 }]),
      2,
    )
    consumeSlot(slots[0], 0, ['Sword', 'Hammer'])
    advanceItemSlots(slots, RESPAWN_MS_DEFAULT - 1, 2)
    expect(slots[0].status).toBe('respawning')
    advanceItemSlots(slots, RESPAWN_MS_DEFAULT, 2)
    expect(slots[0].status).toBe('available')
  })

  test('successive respawns rotate through the weapon pool', () => {
    const slots = makeItemSlots(
      makeGeo([{ kind: 'init', x: 0, y: 0, w: 0, h: 0 }]),
      2,
    )
    const pool = ['Sword', 'Hammer']
    expect(consumeSlot(slots[0], 0, pool)).toBe('Sword')
    advanceItemSlots(slots, RESPAWN_MS_DEFAULT, 2)
    expect(consumeSlot(slots[0], RESPAWN_MS_DEFAULT, pool)).toBe('Hammer')
    advanceItemSlots(slots, 2 * RESPAWN_MS_DEFAULT, 2)
    expect(consumeSlot(slots[0], 2 * RESPAWN_MS_DEFAULT, pool)).toBe('Sword')
  })
})

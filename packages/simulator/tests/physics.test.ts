import { describe, expect, test } from 'bun:test'
import type { CollisionLine, LevelGeometry } from '@brawltome/game-data'
import { InputFlag } from '@brawltome/replay-format'
import { DEFAULT_PHYSICS, makePhysState, stepEntity } from '../src/physics'
import type { EntityState } from '../src/types'

function makeLevel(collisions: CollisionLine[] = []): LevelGeometry {
  return {
    levelName: 'T',
    assetDir: 'T',
    cameraBounds: null,
    spawnBotBounds: null,
    killBounds: { left: null, right: null, top: null, bottom: null },
    respawns: [],
    collisions,
  }
}

function makeEntity(x = 0, y = 0): EntityState {
  return {
    id: 1,
    team: 1,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    facing: 1,
    posture: 'air',
    alive: true,
  }
}

const floor = { kind: 'hard' as const, x1: -5000, x2: 5000, y1: 500, y2: 500 }

describe('stepEntity: gravity', () => {
  test('airborne entity accelerates downward', () => {
    const e = makeEntity(0, 0)
    let phys = makePhysState()
    for (let i = 0; i < 5; i++) phys = stepEntity(e, 0, phys, makeLevel())
    expect(e.vel.y).toBeGreaterThan(0)
    expect(e.pos.y).toBeGreaterThan(0)
    expect(e.posture).toBe('air')
  })

  test('fall speed clamps to maxFallSpeed', () => {
    const e = makeEntity(0, 0)
    e.vel.y = DEFAULT_PHYSICS.maxFallSpeed * 5
    let phys = makePhysState()
    phys = stepEntity(e, 0, phys, makeLevel())
    expect(e.vel.y).toBeLessThanOrEqual(DEFAULT_PHYSICS.maxFallSpeed + 1e-6)
  })
})

describe('stepEntity: ground resolution', () => {
  test('falling entity lands on a hard horizontal line', () => {
    const e = makeEntity(0, 400)
    e.vel.y = 1000
    let phys = makePhysState()
    for (let i = 0; i < 5; i++) phys = stepEntity(e, 0, phys, makeLevel([floor]))
    expect(e.posture).toBe('ground')
    expect(e.pos.y).toBeCloseTo(500, 0)
    expect(e.vel.y).toBe(0)
  })

  test('grounded entity stays grounded while idle', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    for (let i = 0; i < 10; i++) phys = stepEntity(e, 0, phys, makeLevel([floor]))
    expect(e.posture).toBe('ground')
    expect(e.pos.y).toBeCloseTo(500, 0)
    expect(e.vel.x).toBe(0)
    expect(e.vel.y).toBe(0)
  })
})

describe('stepEntity: horizontal movement', () => {
  test('MoveRight on ground advances x at walk speed', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, InputFlag.MoveRight, phys, makeLevel([floor]))
    expect(e.vel.x).toBe(DEFAULT_PHYSICS.walkSpeed)
    expect(e.pos.x).toBeGreaterThan(0)
    expect(e.facing).toBe(1)
  })

  test('MoveLeft on ground sets facing to -1', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, InputFlag.MoveLeft, phys, makeLevel([floor]))
    expect(e.facing).toBe(-1)
    expect(e.vel.x).toBe(-DEFAULT_PHYSICS.walkSpeed)
  })

  test('releasing input on ground zeroes horizontal velocity', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, InputFlag.MoveRight, phys, makeLevel([floor]))
    phys = stepEntity(e, 0, phys, makeLevel([floor]))
    expect(e.vel.x).toBe(0)
  })
})

describe('stepEntity: jump', () => {
  test('edge-triggered jump launches upward from ground', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor]))
    expect(e.vel.y).toBeLessThan(0) // y-down world: upward velocity is negative
    expect(e.posture).toBe('air')
  })

  test('holding Jump does not repeatedly re-launch', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor]))
    const vyAfterJump = e.vel.y
    // keep jump held, simulate a few more ticks
    for (let i = 0; i < 3; i++) phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor]))
    // Still airborne, but no new impulse (gravity accumulates normally).
    expect(e.vel.y).toBeGreaterThan(vyAfterJump)
  })

  test('ground jump + two air jumps (3 total)', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    expect(phys.jumpsRemaining).toBe(3)
    phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor])) // ground
    expect(phys.jumpsRemaining).toBe(2)
    phys = stepEntity(e, 0, phys, makeLevel([floor]))
    phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor])) // air 1
    expect(phys.jumpsRemaining).toBe(1)
    phys = stepEntity(e, 0, phys, makeLevel([floor]))
    phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor])) // air 2
    expect(phys.jumpsRemaining).toBe(0)
  })

  test('fourth jump without landing is ignored', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    // Spend all 3 jumps.
    for (let i = 0; i < 3; i++) {
      phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor]))
      phys = stepEntity(e, 0, phys, makeLevel([floor]))
    }
    expect(phys.jumpsRemaining).toBe(0)
    const before = e.vel.y
    phys = stepEntity(e, InputFlag.Jump, phys, makeLevel([floor])) // fourth attempt
    expect(e.vel.y).toBeGreaterThan(before) // gravity only, no new kick
    expect(phys.jumpsRemaining).toBe(0)
  })

  test('walking off a ledge preserves full jump budget', () => {
    // Ledge: floor from x=0..200, nothing beyond.
    const ledge = { kind: 'hard' as const, x1: 0, x2: 200, y1: 500, y2: 500 }
    const e = makeEntity(150, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    expect(phys.jumpsRemaining).toBe(3)
    // Walk off the right edge. Doesn't consume a jump.
    for (let i = 0; i < 15; i++) {
      phys = stepEntity(e, InputFlag.MoveRight, phys, makeLevel([ledge]))
    }
    expect(e.posture).toBe('air')
    expect(phys.jumpsRemaining).toBe(3)
  })

  test('landing on ground resets the jump count to 3', () => {
    const e = makeEntity(0, 400)
    e.posture = 'air'
    e.vel.y = 800
    let phys = { prevFlags: 0, jumpsRemaining: 0 }
    for (let i = 0; i < 30; i++) phys = stepEntity(e, 0, phys, makeLevel([floor]))
    expect(e.posture).toBe('ground')
    expect(phys.jumpsRemaining).toBe(3)
  })
})

describe('stepEntity: soft platforms', () => {
  test('falling entity lands on a soft line from above', () => {
    const soft = { kind: 'soft' as const, x1: 0, x2: 500, y1: 300, y2: 300 }
    const e = makeEntity(250, 100)
    e.vel.y = 800
    let phys = makePhysState()
    for (let i = 0; i < 10; i++) phys = stepEntity(e, 0, phys, makeLevel([soft]))
    expect(e.posture).toBe('ground')
    expect(e.pos.y).toBeCloseTo(300, 0)
  })

  test('rising entity passes through a soft line from below', () => {
    const soft = { kind: 'soft' as const, x1: 0, x2: 500, y1: 300, y2: 300 }
    const e = makeEntity(250, 400)
    e.vel.y = -1500
    let phys = makePhysState()
    for (let i = 0; i < 5; i++) phys = stepEntity(e, 0, phys, makeLevel([soft]))
    // Didn't snap to the soft line on the way up.
    expect(e.pos.y).toBeLessThan(300)
  })

  test('Drop input phases through a soft platform', () => {
    const soft = { kind: 'soft' as const, x1: 0, x2: 500, y1: 300, y2: 300 }
    const e = makeEntity(250, 100)
    e.vel.y = 800
    let phys = makePhysState()
    for (let i = 0; i < 20; i++) phys = stepEntity(e, InputFlag.Drop, phys, makeLevel([soft]))
    // Held Drop means we never caught on the soft platform.
    expect(e.pos.y).toBeGreaterThan(300)
    expect(e.posture).toBe('air')
  })
})

describe('stepEntity: wall resolution', () => {
  test('horizontal movement into a vertical hard line stops', () => {
    const wall: CollisionLine = { kind: 'hard', x1: 200, x2: 200, y1: 0, y2: 1000 }
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    for (let i = 0; i < 20; i++) {
      phys = stepEntity(e, InputFlag.MoveRight, phys, makeLevel([floor, wall]))
    }
    expect(e.pos.x).toBeLessThanOrEqual(200)
    expect(e.vel.x).toBe(0)
  })
})

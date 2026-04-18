import { describe, expect, test } from 'bun:test'
import type { CollisionLine, LevelGeometry } from '@brawltome/game-data'
import { InputFlag } from '@brawltome/replay-format'
import { DEFAULT_PHYSICS, checkKillAndRespawn, makePhysState, stepEntity } from '../src/physics'
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

  test('releasing input on ground applies friction, not snap-to-zero', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, InputFlag.MoveRight, phys, makeLevel([floor]))
    const velAfterWalk = e.vel.x
    phys = stepEntity(e, 0, phys, makeLevel([floor]))
    // One idle tick: friction coefficient applied, still moving in the old direction.
    expect(e.vel.x).toBeGreaterThan(0)
    expect(e.vel.x).toBeLessThan(velAfterWalk)
  })

  test('sustained no-input on ground eventually brings vel.x to 0', () => {
    const e = makeEntity(0, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, InputFlag.MoveRight, phys, makeLevel([floor]))
    for (let i = 0; i < 60; i++) phys = stepEntity(e, 0, phys, makeLevel([floor]))
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

  test('airborne entity falling flush against a wall registers as wall posture', () => {
    // Vertical hard line at x=200 covering the entire fall path. Entity
    // starts right at the wall with only gravity acting on it; no horizontal
    // velocity, so wallCrossed won't fire. The adjacency check should still
    // classify the tick as 'wall'.
    const wall: CollisionLine = { kind: 'hard', x1: 200, x2: 200, y1: 0, y2: 1000 }
    const e = makeEntity(200, 100)
    e.posture = 'air'
    let phys = makePhysState()
    phys = stepEntity(e, 0, phys, makeLevel([wall]))
    expect(e.posture).toBe('wall')
  })

  test('airborne entity far from any wall stays air', () => {
    const wall: CollisionLine = { kind: 'hard', x1: 200, x2: 200, y1: 0, y2: 1000 }
    const e = makeEntity(-500, 100)
    e.posture = 'air'
    let phys = makePhysState()
    phys = stepEntity(e, 0, phys, makeLevel([wall]))
    expect(e.posture).toBe('air')
  })

  test('grounded entity next to a wall stays ground, not wall', () => {
    // Ground posture wins: standing on a floor right next to a wall still
    // reports 'ground' (wall refinement only applies while airborne).
    const wall: CollisionLine = { kind: 'hard', x1: 200, x2: 200, y1: 0, y2: 1000 }
    const e = makeEntity(200, 500)
    e.posture = 'ground'
    let phys = makePhysState()
    phys = stepEntity(e, 0, phys, makeLevel([floor, wall]))
    expect(e.posture).toBe('ground')
  })
})

describe('checkKillAndRespawn', () => {
  const respawnPoint = { x: 0, y: 0 }
  const bounded = (
    bounds: Partial<LevelGeometry['killBounds']>,
    respawns: { x: number; y: number }[] = [respawnPoint],
  ): LevelGeometry => ({
    ...makeLevel(),
    killBounds: { left: null, right: null, top: null, bottom: null, ...bounds },
    respawns,
  })

  test('all null bounds never kill', () => {
    const e = makeEntity(1e9, 1e9)
    e.vel.x = 500
    const phys = makePhysState()
    const next = checkKillAndRespawn(e, makeLevel(), respawnPoint, phys)
    expect(e.pos.x).toBe(1e9)
    expect(e.vel.x).toBe(500)
    expect(next).toBe(phys)
  })

  test('within bounds does not reset', () => {
    const e = makeEntity(50, 50)
    e.vel.x = 100
    const phys = makePhysState()
    const level = bounded({ left: -1000, right: 1000, top: -500, bottom: 1500 })
    checkKillAndRespawn(e, level, respawnPoint, phys)
    expect(e.pos.x).toBe(50)
    expect(e.vel.x).toBe(100)
  })

  test('crossing left bound respawns', () => {
    const e = makeEntity(-2000, 500)
    const phys = makePhysState()
    const level = bounded({ left: -1000 }, [{ x: 10, y: 20 }])
    checkKillAndRespawn(e, level, level.respawns[0], phys)
    expect(e.pos.x).toBe(10)
    expect(e.pos.y).toBe(20)
  })

  test('crossing right bound respawns', () => {
    const e = makeEntity(5000, 500)
    const phys = makePhysState()
    const level = bounded({ right: 1000 })
    checkKillAndRespawn(e, level, respawnPoint, phys)
    expect(e.pos.x).toBe(0)
    expect(e.pos.y).toBe(0)
  })

  test('crossing top bound respawns', () => {
    const e = makeEntity(0, -1000)
    const phys = makePhysState()
    const level = bounded({ top: -500 })
    checkKillAndRespawn(e, level, respawnPoint, phys)
    expect(e.pos.y).toBe(0)
  })

  test('crossing bottom bound respawns and zeroes velocity', () => {
    const e = makeEntity(0, 3000)
    e.vel.x = 500
    e.vel.y = DEFAULT_PHYSICS.maxFallSpeed
    const phys = makePhysState()
    const level = bounded({ bottom: 2000 })
    checkKillAndRespawn(e, level, respawnPoint, phys)
    expect(e.pos.y).toBe(0)
    expect(e.vel.x).toBe(0)
    expect(e.vel.y).toBe(0)
    expect(e.posture).toBe('air')
  })

  test('respawn refills the jump budget even if it was spent', () => {
    const e = makeEntity(0, 3000)
    const phys = { prevFlags: 0, jumpsRemaining: 0 }
    const level = bounded({ bottom: 2000 })
    const next = checkKillAndRespawn(e, level, respawnPoint, phys)
    expect(next.jumpsRemaining).toBe(3)
  })

  test('falling off the void in the sim loop snaps back to a respawn point', () => {
    // Drive stepEntity in a level with a deep pit and a bottom kill bound.
    // Entity starts airborne above empty space and falls until killed.
    const pit: LevelGeometry = {
      ...makeLevel(),
      killBounds: { left: null, right: null, top: null, bottom: 1500 },
      respawns: [{ x: 0, y: 0 }],
    }
    const e = makeEntity(0, 0)
    let phys = makePhysState()
    for (let i = 0; i < 60; i++) {
      phys = stepEntity(e, 0, phys, pit)
      phys = checkKillAndRespawn(e, pit, pit.respawns[0], phys)
    }
    // 60 ticks is long enough for gravity to drive past the bound at least once;
    // after any kill, pos is clamped back toward 0 and jumps are refilled.
    expect(e.pos.y).toBeLessThanOrEqual(1500)
    expect(phys.jumpsRemaining).toBe(3)
  })
})

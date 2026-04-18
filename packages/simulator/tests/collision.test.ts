import { describe, expect, test } from 'bun:test'
import type { LevelGeometry } from '@brawltome/game-data'
import { classifyPosture } from '../src/collision'

function makeLevel(overrides: Partial<LevelGeometry> = {}): LevelGeometry {
  return {
    levelName: 'TestLevel',
    assetDir: 'Test',
    cameraBounds: null,
    spawnBotBounds: null,
    killBounds: { left: null, right: null, top: null, bottom: null },
    respawns: [],
    collisions: [],
    ...overrides,
  }
}

describe('classifyPosture', () => {
  test("classifies 'ground' when directly on a horizontal hard line", () => {
    const level = makeLevel({
      collisions: [{ kind: 'hard', x1: 0, x2: 1000, y1: 500, y2: 500 }],
    })
    expect(classifyPosture({ x: 500, y: 500 }, level)).toBe('ground')
  })

  test("classifies 'air' when above a horizontal line by more than the probe", () => {
    const level = makeLevel({
      collisions: [{ kind: 'hard', x1: 0, x2: 1000, y1: 500, y2: 500 }],
    })
    expect(classifyPosture({ x: 500, y: 200 }, level)).toBe('air')
  })

  test("classifies 'air' when outside the horizontal segment's x range", () => {
    const level = makeLevel({
      collisions: [{ kind: 'hard', x1: 0, x2: 1000, y1: 500, y2: 500 }],
    })
    expect(classifyPosture({ x: 2000, y: 500 }, level)).toBe('air')
  })

  test("classifies 'wall' when flush against a vertical hard line", () => {
    const level = makeLevel({
      collisions: [
        { kind: 'hard', x1: 0, x2: 2000, y1: 600, y2: 600 }, // floor elsewhere
        { kind: 'hard', x1: 500, x2: 500, y1: 200, y2: 400 }, // vertical wall
      ],
    })
    expect(classifyPosture({ x: 500, y: 300 }, level)).toBe('wall')
  })

  test('ignores soft platforms when deciding posture', () => {
    const level = makeLevel({
      collisions: [{ kind: 'soft', x1: 0, x2: 1000, y1: 500, y2: 500 }],
    })
    expect(classifyPosture({ x: 500, y: 500 }, level)).toBe('air')
  })
})

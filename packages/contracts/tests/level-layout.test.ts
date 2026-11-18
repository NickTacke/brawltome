import { describe, expect, test } from 'bun:test'
import { levelLayoutSchema } from '../src/level-layout'

const bounds = { x: -100, y: 0, width: 3000, height: 1600 }
const ground = { fromX: 200, fromY: 900, toX: 2600, toY: 900, isSoft: false }
const art = { file: 'Platform_Small.png', x: 180, y: 880, width: 400, height: 120, rotation: 0 }
const layout = { camera: bounds, killBounds: bounds, collisions: [ground], art: [art], background: null }

describe('level layout contract', () => {
  test('accepts a layout as the map files carry it, with or without a background', () => {
    expect(levelLayoutSchema.parse(layout)).toEqual(layout)

    expect(levelLayoutSchema.parse({ ...layout, background: 'Backgrounds.BG_Demon.jpg' }).background).toBe(
      'Backgrounds.BG_Demon.jpg',
    )
  })

  test('rejects a missing camera and an unknown field', () => {
    const { camera: _camera, ...withoutCamera } = layout

    expect(() => levelLayoutSchema.parse(withoutCamera)).toThrow()
    expect(() => levelLayoutSchema.parse({ ...layout, extra: true })).toThrow()
    expect(() => levelLayoutSchema.parse({ ...layout, collisions: [{ ...ground, isSoft: 'yes' }] })).toThrow()
  })
})

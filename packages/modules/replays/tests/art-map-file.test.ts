import { describe, expect, test } from 'bun:test'
import { readMapFileSheets } from '../art-map-file'

const background = 'sheets/5555555555555555.webp'
const platform = 'sheets/6666666666666666.webp'

describe('readMapFileSheets', () => {
  test('lists the background and every platform art sheet, once each', () => {
    const mapFile = {
      format: 3,
      background: { asset: background, width: 100, height: 50 },
      artAssets: { 'Test.Plat.png': platform, 'Test.Same.png': platform },
    }

    expect(readMapFileSheets(mapFile)).toEqual({ paths: [background, platform] })
  })

  test('names no sheets for a map file without a background or platform art', () => {
    expect(readMapFileSheets({ format: 3, background: null })).toEqual({ paths: [] })
    expect(readMapFileSheets({ format: 3, artAssets: {} })).toEqual({ paths: [] })
  })

  test('refuses platform art that is not a sheet in the art layout', () => {
    expect(readMapFileSheets({ artAssets: { 'Test.Plat.png': '../x' } })).toHaveProperty('reason')

    expect(readMapFileSheets({ artAssets: { 'Test.Plat.png': `maps/${'4'.repeat(32)}.json` } })).toHaveProperty(
      'reason',
    )

    expect(readMapFileSheets({ artAssets: { 'Test.Plat.png': 7 } })).toHaveProperty('reason')
    expect(readMapFileSheets({ artAssets: [platform] })).toHaveProperty('reason')
  })

  test('names at most 100 characters of a refused file in the reason', () => {
    const read = readMapFileSheets({ artAssets: { ['x'.repeat(5000)]: '../x' } })

    expect(read).toEqual({ reason: `the map file's artAssets.${'x'.repeat(100)} is not a sheet file path` })
  })

  test('refuses a background that is not a sheet', () => {
    expect(readMapFileSheets({ background: { asset: '../x' } })).toHaveProperty('reason')
    expect(readMapFileSheets({ background: 'sheets/5555555555555555.webp' })).toHaveProperty('reason')
  })
})

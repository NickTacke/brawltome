import { describe, expect, test } from 'bun:test'
import { readManifestPaths } from '../art-manifest'
import { fakeManifest } from './fixtures/art'

describe('readManifestPaths', () => {
  test('lists every file a manifest names, once each', () => {
    const read = readManifestPaths(fakeManifest())

    expect('paths' in read && read.paths.sort()).toEqual(
      [
        `art/${'1'.repeat(32)}.json`,
        `art/${'2'.repeat(32)}.json`,
        `art/${'3'.repeat(32)}.json`,
        `maps/${'4'.repeat(32)}.json`,
        'sheets/5555555555555555.webp',
        'sheets/6666666666666666.webp',
        'anims/7777777777777777.bin',
        'anims/8888888888888888.bin',
        'anims/9999999999999999.bin',
      ].sort(),
    )
  })

  test('refuses a manifest of another format', () => {
    expect(readManifestPaths({ ...fakeManifest(), format: 2 })).toHaveProperty('reason')
  })

  test('refuses something that is not a manifest', () => {
    expect(readManifestPaths(null)).toHaveProperty('reason')
    expect(readManifestPaths([])).toHaveProperty('reason')
    expect(readManifestPaths({ ...fakeManifest(), players: 'none' })).toHaveProperty('reason')
  })

  test('refuses a manifest naming a path outside the art layout', () => {
    const manifest = fakeManifest()

    manifest.players['1'].art.push('../secrets.json')

    expect(readManifestPaths(manifest)).toHaveProperty('reason')
  })

  test('refuses a manifest whose map layout is not a map file', () => {
    const manifest = fakeManifest()

    manifest.map.layout = `art/${'1'.repeat(32)}.json`

    expect(readManifestPaths(manifest)).toHaveProperty('reason')
  })
})

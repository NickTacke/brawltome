import { describe, expect, test } from 'bun:test'
import { readManifestPaths } from '../art-manifest'
import { fakeManifest, fakeManifestFormat4 } from './fixtures/art'

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

  test('lists the same files for a format 4 manifest, whose looks name none', () => {
    expect(readManifestPaths(fakeManifestFormat4())).toEqual(readManifestPaths(fakeManifest()))
  })

  test.each([2, 5, '3'])('refuses a manifest of format %p', (format) => {
    expect(readManifestPaths({ ...fakeManifest(), format })).toEqual({
      reason: `the manifest has format ${format}, not 3 or 4`,
    })
  })

  test('takes a format 4 player with no looks yet', () => {
    const manifest = fakeManifestFormat4()

    manifest.players['1'].looks = []

    expect(readManifestPaths(manifest)).toHaveProperty('paths')
  })

  test.each([
    ['no looks', undefined],
    ['looks that are not a list', {}],
    ['a look with no weapon', [{ art: [0], swaps: [] }]],
    ['a look with no art', [{ weapon: 'Fists', swaps: [] }]],
    ['a look at a group the player lacks', [{ weapon: 'Fists', art: [2], swaps: [] }]],
    ['a look at a group by path', [{ weapon: 'Fists', art: [`art/${'1'.repeat(32)}.json`], swaps: [] }]],
    ['a look with no swaps', [{ weapon: 'Fists', art: [0] }]],
    ['a look whose look is not an index', [{ weapon: 'Fists', look: -1, art: [0], swaps: [] }]],
    ['a swap that is not [from, to, art type]', [{ weapon: 'Fists', art: [0], swaps: [[1, 2]] }]],
  ])('refuses a format 4 manifest with %s', (_, looks) => {
    const manifest = fakeManifestFormat4()

    Object.assign(manifest.players['1'], { looks })

    expect(readManifestPaths(manifest)).toEqual({ reason: "the manifest's players.1.looks are not looks at its art" })
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

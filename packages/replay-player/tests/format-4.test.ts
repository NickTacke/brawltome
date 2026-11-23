// format 4 files as the loader reads them: three real sets drawn by brawlhalla-anims `predraw draw --check` from
// 11.01 (the PistolCowgirl and KatarDKSent weapon skins and the orb's FirstPickUp class set, its pickup flash), a
// manifest naming them beside a format 3 group, and the ways a format 4 file can be wrong
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadReplay } from '..'
import type { AnyArtGroup, ArtGroupFormat4, ManifestFormat4 } from '../src/format.ts'
import { readArtGroup, readManifest } from '../src/read.ts'
import { stubImageBitmaps } from './art-store.ts'
import { writePack } from './pack-writer.ts'

const fixtures = join(import.meta.dir, 'fixtures')

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(fixtures, path), 'utf8')) as T

const pistolPath = 'art/583f0e4a79e7ae898cb46b0d1a0d1013.json'
const katarPath = 'art/a6fb7d38ffc351c4f451b961883e539b.json'
const pickupPath = 'art/2b6dca814eb474124bef818ad8395d4c.json'
// a match's own group, in format 3
const ownPath = 'art/9e79c1d66d6b83f8f5691d04d489bfe3.json'
const packPath = 'anims/0123456789abcdef.bin'

const files = new Map<string, AnyArtGroup>([
  [pistolPath, readJson('format-4/583f0e4a79e7ae898cb46b0d1a0d1013.json')],
  [katarPath, readJson('format-4/a6fb7d38ffc351c4f451b961883e539b.json')],
  [pickupPath, readJson('format-4/2b6dca814eb474124bef818ad8395d4c.json')],
  [ownPath, readJson('format-3/9e79c1d66d6b83f8f5691d04d489bfe3.json')],
])

const setOf = (path: string) => structuredClone(files.get(path)) as ArtGroupFormat4

// a 1v1's player in two looks: the pistol and the katar, each with the orb's pickup flash and the match's own group
function manifestOf(): ManifestFormat4 {
  return {
    format: 4,
    replay: 'match.replay',
    patch: '11.01',
    map: { id: 135, name: 'Demon Island', layout: 'maps/891d9db3edd06453f2526e1301156d87.json' },
    animations: [],
    objectAnimations: [],
    start: { from: 0, to: 94 },
    sheetOrder: [],
    players: {
      '1': {
        slot: 1,
        name: 'Player',
        legend: { id: 3, name: 'Bodvar' },
        look: { skin: 0, colorScheme: 29, weaponSkins: [4, 875] },
        art: [pistolPath, katarPath, pickupPath, ownPath],
        start: packPath,
        startAnimations: [],
        looks: [
          { weapon: 'Pistol', look: 0, art: [0, 2, 3], swaps: [[0xb06400, 0x123456, 1]] },
          { weapon: 'Katar', art: [1, 2, 3], swaps: [] },
        ],
      },
    },
    bytes: {},
  }
}

const artUrl = 'https://art.test/'
const manifestUrl = 'https://brawltome.test/matches/abc/manifest.json'

function fetchOf(manifest: unknown) {
  return async (url: string): Promise<Response> => {
    if (url === manifestUrl) return Response.json(manifest)

    if (url === `${artUrl}${packPath}`) return new Response(writePack([]))

    if (url.startsWith(`${artUrl}sheets/`)) return new Response(new Blob(['sheet']))

    const file = files.get(url.slice(artUrl.length))

    return file === undefined ? new Response(null, { status: 404 }) : Response.json(file)
  }
}

beforeAll(stubImageBitmaps)

describe('reading format 4', () => {
  test.each([pistolPath, katarPath, pickupPath])('reads the set %s as it was drawn', (path) => {
    expect(readArtGroup(setOf(path), path)).toEqual(setOf(path))
  })

  test('loadReplay loads a format 4 manifest whose player draws from sets and a format 3 group', async () => {
    const manifest = manifestOf()
    const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch: fetchOf(manifest) })

    await replay.loaded

    expect(replay.manifest).toEqual(manifest)
    expect(replay.groups.map((group) => group.url)).toEqual([pistolPath, katarPath, pickupPath, ownPath])
    expect(replay.groups.map((group) => group.json)).toEqual([...files.values()])
    expect(replay.players.get('1')?.info).toEqual(manifest.players['1'])
  })

  test('a format 4 look may leave out its index into the line looks and have no swaps', () => {
    const manifest = manifestOf()

    manifest.players['1'].looks = [{ weapon: 'Katar', art: [], swaps: [] }]

    expect(readManifest(manifest, manifestUrl)).toEqual(manifest)
  })

  test('a format 4 player may have no looks', () => {
    const manifest = manifestOf()

    manifest.players['1'].looks = []

    expect(readManifest(manifest, manifestUrl)).toEqual(manifest)
  })

  test('a group with neither set nor swappable colours reads, as a match writes its own', () => {
    const { set: _set, swappable: _swappable, ...group } = setOf(pistolPath)

    expect(readArtGroup(group, pistolPath)).toEqual(group)
  })
})

describe('refusing what neither format is', () => {
  test.each([2, 5, '4', undefined])('loadReplay refuses a manifest of format %p', async (format) => {
    const manifest = { ...manifestOf(), format }

    await expect(loadReplay(manifestUrl, { baseUrl: artUrl, fetch: fetchOf(manifest) })).rejects.toThrow(
      `load replay ${manifestUrl}: manifest format ${String(format)}, expected 3 or 4`,
    )
  })

  test.each([2, 5, '3'])('loadReplay refuses an art group of format %p', async (format) => {
    files.set(ownPath, { ...setOf(ownPath), format } as unknown as AnyArtGroup)

    try {
      await expect(loadReplay(manifestUrl, { baseUrl: artUrl, fetch: fetchOf(manifestOf()) })).rejects.toThrow(
        `load replay file ${artUrl}${ownPath}: art group format ${String(format)}, expected 3 or 4`,
      )
    } finally {
      files.set(ownPath, readJson('format-3/9e79c1d66d6b83f8f5691d04d489bfe3.json'))
    }
  })
})

type ManifestChange = [string, (manifest: ManifestFormat4) => void, string]

const wrongManifests: ManifestChange[] = [
  [
    'no looks',
    (manifest) => delete (manifest.players['1'] as Partial<{ looks: unknown }>).looks,
    'player 1 has no looks',
  ],
  [
    'a look that is not an object',
    (manifest) => Object.assign(manifest.players['1'].looks, [null]),
    'player 1 look 0 is not an object',
  ],
  [
    'a look with no weapon',
    (manifest) => Object.assign(manifest.players['1'].looks[0], { weapon: 3 }),
    'player 1 look 0 names no weapon',
  ],
  [
    'a look index that is not an index',
    (manifest) => Object.assign(manifest.players['1'].looks[0], { look: -1 }),
    'player 1 look 0 has look -1, not an index',
  ],
  [
    'a look drawing from a group the player lacks',
    (manifest) => manifest.players['1'].looks[1].art.push(4),
    'player 1 look 1 draws from art 4, but the player has 4 groups',
  ],
  [
    'a look with no swaps',
    (manifest) => Object.assign(manifest.players['1'].looks[0], { swaps: undefined }),
    'player 1 look 0 has no swaps',
  ],
  [
    'a swap of two numbers',
    (manifest) => Object.assign(manifest.players['1'].looks[0], { swaps: [[0xb06400, 0x123456]] }),
    'player 1 look 0 has swap 0, not [from, to, art type]',
  ],
]

test.each(wrongManifests)('loadReplay refuses a format 4 manifest with %s', async (_, change, problem) => {
  const manifest = manifestOf()

  change(manifest)

  await expect(loadReplay(manifestUrl, { baseUrl: artUrl, fetch: fetchOf(manifest) })).rejects.toThrow(
    `load replay ${manifestUrl}: manifest ${problem}`,
  )
})

type GroupChange = [string, (group: ArtGroupFormat4) => void, string]

const wrongGroups: GroupChange[] = [
  ['no sheets', (group) => Object.assign(group, { sheets: undefined }), 'has no sheets'],
  ['a sheet with no src', (group) => Object.assign(group.sheets[0], { src: 7 }), 'sheet 0 has no src'],
  [
    'weights that are not a list',
    (group) => Object.assign(group.sheets[0], { weights: {} }),
    'sheet 0 has weights that are not a list of sheets',
  ],
  [
    'an empty list of weights',
    (group) => Object.assign(group.sheets[0], { weights: [] }),
    'sheet 0 has weights that are not a list of sheets',
  ],
  [
    'nine weight sheets',
    (group) =>
      Object.assign(group.sheets[0], { weights: Array(9).fill({ src: 'sheets/0000000000000000.webp', bytes: 1 }) }),
    'sheet 0 has 9 weight sheets, more than 8',
  ],
  [
    'a weight sheet with no size',
    (group) => Object.assign(group.sheets[0].weights?.[1] ?? {}, { bytes: undefined }),
    'sheet 0 has weight sheet 1, not { src, bytes }',
  ],
  [
    'a set of an unknown kind',
    (group) => Object.assign(group, { set: { kind: 'legend', drawing: 1 } }),
    'has a set that is not { kind, drawing }',
  ],
  [
    'a set with no drawing',
    (group) => Object.assign(group, { set: { kind: 'weaponSkin' } }),
    'has a set that is not { kind, drawing }',
  ],
  [
    'swappable colours that are not a list',
    (group) => Object.assign(group, { swappable: {} }),
    'has swappable colours that are not a list',
  ],
  [
    'swappable colours for fewer pieces than it has',
    (group) => group.swappable?.pop(),
    'has swappable colours for 1 pieces, but 2 pieces',
  ],
  [
    'an art type with no colours',
    (group) => Object.assign(group.swappable ?? [], { 1: [1] }),
    'piece 1 has an art type but no colours',
  ],
  [
    'an art type that is not a number',
    (group) => Object.assign(group.swappable ?? [], { 0: ['1', 0xb06400] }),
    'piece 0 has art type 1, not a number',
  ],
  [
    'a colour past 0xffffff',
    (group) => group.swappable?.[0].push(0x1000000),
    'piece 0 has colour 16777216, not an RGB colour',
  ],
  [
    'more colours than its weight sheets hold',
    (group) => group.swappable?.[1].push(0x010203, 0x040506),
    'piece 1 keeps 7 colours, but its sheet has 2 weight sheets',
  ],
  [
    'colours on a sheet without weights',
    (group) => delete group.sheets[0].weights,
    'piece 0 keeps 5 colours, but its sheet has 0 weight sheets',
  ],
]

test.each(wrongGroups)('loadReplay refuses a format 4 group with %s', async (_, change, problem) => {
  const group = setOf(pistolPath)

  change(group)
  files.set(pistolPath, group)

  try {
    await expect(loadReplay(manifestUrl, { baseUrl: artUrl, fetch: fetchOf(manifestOf()) })).rejects.toThrow(
      `load replay file ${artUrl}${pistolPath}: art group ${problem}`,
    )
  } finally {
    files.set(pistolPath, readJson('format-4/583f0e4a79e7ae898cb46b0d1a0d1013.json'))
  }
})

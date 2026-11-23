// a real format 3 player's art groups, from an export of a 1v1 on Demon Island (11.00), read as the loader reads them.
// fixtures/format-3/art-set.json is what master's reader made of them before format 4, so a change to how groups are
// read can't change what a format 3 match draws
import { beforeAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadReplay, type Manifest } from '..'
import type { ArtGroup } from '../src/format.ts'
import { ArtSet } from '../src/placement.ts'
import { type ArtSetDump, boneNamesOf, dumpArtSet } from './art-set-dump.ts'
import { stubImageBitmaps } from './art-store.ts'
import { writePack } from './pack-writer.ts'

const fixtures = join(import.meta.dir, 'fixtures', 'format-3')

// the player's art groups in lookup order
const groupNames = [
  '9e79c1d66d6b83f8f5691d04d489bfe3',
  'fef109a25bb2e29f16a0e08ed60263fb',
  'bbb4b18f095d61dff430f5665a6119a2',
  'c35633d35a9dad8368bcbd670596ab1d',
  'b7aa2c097925b421ce91604f6ed02317',
  '643b18bf4cd19b908c8ddbab15ff32ac',
]

const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8')) as T

const groups = groupNames.map((name) => readJson<ArtGroup>(name))
const expected = readJson<ArtSetDump>('art-set')
const boneNames = boneNamesOf(groups)

beforeAll(stubImageBitmaps)

test('a format 3 player reads into the tables it did before format 4', () => {
  const set = new ArtSet(
    groups.map((_, index) => index),
    (index) => groups[index],
  )

  expect(dumpArtSet(set, boneNames)).toEqual(expected)
})

const artUrl = 'https://art.test/'
const manifestUrl = 'https://brawltome.test/matches/abc/manifest.json'
const packPath = 'anims/0123456789abcdef.bin'

const manifest = {
  format: 3,
  replay: 'match.replay',
  patch: '11.00',
  map: { id: 135, name: 'Demon Island', layout: 'maps/891d9db3edd06453f2526e1301156d87.json' },
  animations: [],
  objectAnimations: [],
  start: { from: 0, to: 94 },
  sheetOrder: [],
  players: {
    '1': {
      slot: 1,
      name: 'Player',
      legend: { id: 28, name: 'KOR' },
      look: { skin: 248, colorScheme: 128, weaponSkins: [608, 607] },
      art: groupNames.map((name) => `art/${name}.json`),
      start: packPath,
      startAnimations: [],
    },
  },
  bytes: {},
} as unknown as Manifest

// serves the manifest, the groups, an empty pack and a stand-in for every sheet
async function fetchFixture(url: string): Promise<Response> {
  if (url === manifestUrl) return Response.json(manifest)

  if (url === `${artUrl}${packPath}`) return new Response(writePack([]))

  const name = groupNames.find((groupName) => url === `${artUrl}art/${groupName}.json`)

  if (name) return Response.json(readJson(name))

  if (url.startsWith(`${artUrl}sheets/`)) return new Response(new Blob(['sheet']))

  return new Response(null, { status: 404 })
}

test('loadReplay reads a format 3 match as it did before format 4', async () => {
  const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch: fetchFixture })
  const player = replay.players.get('1')

  await replay.loaded

  expect(replay.manifest).toEqual(manifest)
  expect(replay.groups.map((group) => group.json)).toEqual(groups)
  expect(player && dumpArtSet(player.set, boneNames)).toEqual(expected)
})

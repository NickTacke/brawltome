import { expect, test } from 'bun:test'
import { loadReplay, type Manifest } from '..'
import { writePack } from './pack-writer.ts'

const groupPath = 'art/0123456789abcdef0123456789abcdef.json'
const packPath = 'anims/0123456789abcdef.bin'
const mapPath = 'maps/fedcba9876543210fedcba9876543210.json'

// a match of one player whose only art group draws nothing, so loading fetches no sheets
function manifestOf(format: number): Manifest {
  return {
    format,
    replay: 'match.replay',
    patch: '11.00',
    map: { id: 135, name: 'Demon Island', layout: mapPath },
    animations: [],
    objectAnimations: [],
    start: { from: 0, to: 94 },
    sheetOrder: [],
    players: {
      '1': {
        slot: 1,
        name: 'Player',
        legend: { id: 3, name: 'Bodvar' },
        look: { skin: 0, colorScheme: 0, weaponSkins: [] },
        art: [groupPath],
        start: packPath,
        startAnimations: [],
      },
    },
    bytes: {},
  } as unknown as Manifest
}

const emptyGroup = { format: 3, sheets: [], pieces: [], bones: {}, weapons: {} }

// stubFetch answers the manifest at manifestUrl and the art at artUrl, and records every url asked for
function stubFetch(manifest: Manifest, manifestUrl: string, artUrl: string) {
  const urls: string[] = []

  const files = new Map<string, () => Response>([
    [manifestUrl, () => Response.json(manifest)],
    [`${artUrl}${groupPath}`, () => Response.json(emptyGroup)],
    [`${artUrl}${packPath}`, () => new Response(writePack([]))],
  ])

  const fetch = async (url: string) => {
    urls.push(url)

    return files.get(url)?.() ?? new Response(null, { status: 404 })
  }

  return { urls, fetch }
}

const manifestUrl = 'https://brawltome.test/matches/abc/manifest.json'

test('loadReplay rejects a manifest of another format', async () => {
  const { fetch } = stubFetch(manifestOf(2), manifestUrl, 'https://art.test/')

  await expect(loadReplay(manifestUrl, { baseUrl: 'https://art.test/', fetch })).rejects.toThrow(
    'manifest format 2, expected 3',
  )
})

test('loadReplay resolves group paths against baseUrl', async () => {
  const { urls, fetch } = stubFetch(manifestOf(3), manifestUrl, 'https://art.test/')

  const replay = await loadReplay(manifestUrl, { baseUrl: 'https://art.test/', fetch })

  await replay.loaded

  expect(urls).toContain(`https://art.test/${groupPath}`)
  expect(urls).toContain(`https://art.test/${packPath}`)
  expect(urls.filter((url) => url.startsWith('https://brawltome.test/'))).toEqual([manifestUrl])
  expect(replay.assetUrl(replay.manifest.map.layout)).toBe(`https://art.test/${mapPath}`)
})

test('loadReplay keeps the folder of a baseUrl written without a trailing slash', async () => {
  const { urls, fetch } = stubFetch(manifestOf(3), manifestUrl, 'https://art.test/store/')

  await loadReplay(manifestUrl, { baseUrl: 'https://art.test/store', fetch })

  expect(urls).toContain(`https://art.test/store/${groupPath}`)
})

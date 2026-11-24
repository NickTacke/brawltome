// drawing from pre-drawn sets, on a tiny synthetic store: a skin set of three sheets, two weighted and one plain, and
// a katar weapon skin set of one weighted sheet. Player 1 has two looks, unarmed and with the katar, in the same skin
// colours; player 2 wears the same skin in another colour. The start pack draws the body, the rest pack an arm, and
// nothing draws the leg, whose sheet is never fetched
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { drawPlayer, isReady, loadReplay, type PlayerPose, type Replay } from '..'
import type { ArtGroupFormat4, Manifest, ManifestFormat4, ManifestLook } from '../src/format.ts'
import { groupOf } from '../src/placement.ts'
import { composedSheets, type FakeBitmap, imageBlob, installFakeCanvas, removeFakeCanvas } from './fake-canvas.ts'
import { writePack } from './pack-writer.ts'

const artUrl = 'https://art.test/'
const manifestUrl = 'https://brawltome.test/matches/abc/manifest.json'

const skinPath = 'art/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
const katarPath = 'art/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
const ownPath = 'art/cccccccccccccccccccccccccccccccc.json'
const startPackPath = 'anims/1111111111111111.bin'
const restPackPath = 'anims/2222222222222222.bin'

const sheetPath = (name: string) => `sheets/${name.padStart(16, '0')}.webp`

const bodySheet = sheetPath('b0')
const bodyWeights = sheetPath('b1')
const armSheet = sheetPath('a0')
const armWeights = sheetPath('a1')
const legSheet = sheetPath('c0')
const katarSheet = sheetPath('d0')
const katarWeights = sheetPath('d1')
const ownSheet = sheetPath('e0')

// the skin's one swappable colour and the katar's
const SKIN_COLOR = 0x112233
const KATAR_COLOR = 0x445566

// a weighted sheet's base: two 2 by 2 pieces side by side, opaque black, where the weight sheet gives the first
// column of each piece all of the swappable colour and the second none
const base = Array.from({ length: 8 }, () => [0, 0, 0, 255]).flat()
const weights = Array.from({ length: 8 }, (_, pixel) => (pixel % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 0, 255])).flat()
const plain = Array.from({ length: 4 }, () => [9, 9, 9, 255]).flat()

const sheetFiles = new Map<string, Blob>([
  [bodySheet, imageBlob(4, 2, base)],
  [bodyWeights, imageBlob(4, 2, weights)],
  [armSheet, imageBlob(4, 2, base)],
  [armWeights, imageBlob(4, 2, weights)],
  [legSheet, imageBlob(2, 2, plain)],
  [katarSheet, imageBlob(4, 2, base)],
  [katarWeights, imageBlob(4, 2, weights)],
  [ownSheet, imageBlob(2, 2, plain)],
])

const weighted = (src: string, weightSrc: string) => ({
  src,
  w: 4,
  h: 2,
  bytes: 100,
  weights: [{ src: weightSrc, bytes: 10 }],
})

function skinSet(): ArtGroupFormat4 {
  return {
    format: 4,
    sheets: [
      weighted(bodySheet, bodyWeights),
      weighted(armSheet, armWeights),
      { src: legSheet, w: 2, h: 2, bytes: 100 },
    ],
    pieces: [
      [0, 0, 0, 2, 2, 0, 0, 2, 2],
      [0, 2, 0, 2, 2, 0, 0, 2, 2],
      [1, 0, 0, 2, 2, 0, 0, 2, 2],
      [1, 2, 0, 2, 2, 0, 0, 2, 2],
      [2, 0, 0, 2, 2, 0, 0, 2, 2],
    ],
    bones: { a_Body: [0, 1], a_Arm: [2, 3], a_Leg: [4] },
    weapons: {},
    set: { kind: 'skin', drawing: 1 },
    swappable: [[2, SKIN_COLOR], [2, SKIN_COLOR], [2, SKIN_COLOR], [2, SKIN_COLOR], []],
  }
}

// the katar's set holds one frame of the arm, which it shows for any frame
function katarSet(): ArtGroupFormat4 {
  return {
    format: 4,
    sheets: [weighted(katarSheet, katarWeights)],
    pieces: [[0, 0, 0, 2, 2, 0, 0, 2, 2]],
    bones: { a_Arm: [0] },
    weapons: {},
    set: { kind: 'weaponSkin', drawing: 1 },
    swappable: [[1, KATAR_COLOR]],
  }
}

// a match's own group, in format 3: its whole sheet loads whatever the packs draw
const ownGroup = {
  format: 3,
  sheets: [{ src: ownSheet, w: 2, h: 2, bytes: 100 }],
  pieces: [[0, 0, 0, 2, 2, 0, 0, 2, 2]],
  bones: { a_Hat: [0] },
  weapons: {},
}

const drawOf = (name: string, spriteFrame: number) => ({ name, spriteFrame, opacity: 1, matrix: [1, 0, 0, 1, 0, 0] })

const BODY_ANIMATION = 0
const ARM_ANIMATION = 1

const startPack = writePack([{ index: BODY_ANIMATION, frameCount: 1, frames: new Map([[0, [drawOf('a_Body', 0)]]]) }])
const restPack = writePack([{ index: ARM_ANIMATION, frameCount: 1, frames: new Map([[0, [drawOf('a_Arm', 1)]]]) }])

const RED = 0xff0000
const BLUE = 0x0000ff
const GREEN = 0x00ff00

const unarmed: ManifestLook = { weapon: 'Unarmed', look: 0, art: [1, 2], swaps: [[SKIN_COLOR, RED, 2]] }

const withKatar: ManifestLook = {
  weapon: 'Katar',
  look: 1,
  art: [0, 1, 2],
  swaps: [
    [SKIN_COLOR, RED, 2],
    [KATAR_COLOR, GREEN, 1],
  ],
}

function playerOf(slot: number, looks: ManifestLook[]) {
  return {
    slot,
    name: `Player ${slot}`,
    legend: { id: 3, name: 'Bodvar' },
    look: { skin: 0, colorScheme: 0, weaponSkins: [] },
    art: [katarPath, skinPath, ownPath],
    start: startPackPath,
    rest: restPackPath,
    startAnimations: [BODY_ANIMATION],
    looks,
  }
}

function manifestOf(): ManifestFormat4 {
  return {
    format: 4,
    replay: 'match.replay',
    patch: '11.01',
    map: { id: 135, name: 'Demon Island', layout: 'maps/66666666666666666666666666666666.json' },
    animations: [],
    objectAnimations: [],
    start: { from: 0, to: 94 },
    sheetOrder: [ownSheet],
    players: {
      '1': playerOf(1, [unarmed, withKatar]),
      '2': playerOf(2, [{ weapon: 'Unarmed', art: [1, 2], swaps: [[SKIN_COLOR, BLUE, 2]] }]),
    },
    bytes: { [ownSheet]: 100 },
  }
}

type StoreChange = { groups?: Map<string, unknown>; missing?: string[] }

// stubStore serves the synthetic store and records every url asked for; missing paths answer 404
function stubStore(manifest: unknown, change: StoreChange = {}) {
  const urls: string[] = []

  const groups =
    change.groups ??
    new Map<string, unknown>([
      [skinPath, skinSet()],
      [katarPath, katarSet()],
      [ownPath, ownGroup],
    ])

  const fetch = async (url: string): Promise<Response> => {
    urls.push(url)

    const path = url.slice(artUrl.length)

    if (url === manifestUrl) return Response.json(manifest)

    if (change.missing?.includes(path)) return new Response(null, { status: 404 })

    if (path === startPackPath) return new Response(startPack)

    if (path === restPackPath) return new Response(restPack)

    const sheet = sheetFiles.get(path)

    if (sheet) return new Response(sheet)

    return groups.has(path) ? Response.json(groups.get(path)) : new Response(null, { status: 404 })
  }

  return {
    urls,
    fetch,
    sheetsFetched: () => urls.map((url) => url.slice(artUrl.length)).filter((path) => path.startsWith('sheets/')),
  }
}

async function loaded(manifest: unknown = manifestOf(), change: StoreChange = {}) {
  const store = stubStore(manifest, change)
  const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch: store.fetch })

  await replay.loaded

  return { replay, store }
}

// sheetOfGroup is the bitmap a group draws one of its sheets from
function sheetOfGroup(replay: Replay, url: string, sheet: number, nth = 0): FakeBitmap {
  const group = replay.groups.filter((candidate) => candidate.url === url)[nth]

  return group?.sheets[sheet] as unknown as FakeBitmap
}

const pixelAt = (bitmap: FakeBitmap, x: number, y: number) => [
  ...bitmap.pixels.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4),
]

beforeAll(installFakeCanvas)
afterAll(removeFakeCanvas)

describe('loading a match drawn from sets', () => {
  test('fetches only the sheets the packs draw from, each with its weight sheets', async () => {
    const { store } = await loaded()

    expect(store.sheetsFetched().sort()).toEqual(
      [armSheet, armWeights, bodySheet, bodyWeights, ownSheet, katarSheet, katarWeights].sort(),
    )
  })

  test("composes a sheet in each player's colours", async () => {
    const { replay } = await loaded()

    // the first column of each piece is the swappable colour, the second the base's black
    expect(pixelAt(sheetOfGroup(replay, skinPath, 0, 0), 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(sheetOfGroup(replay, skinPath, 0, 0), 1, 0)).toEqual([0, 0, 0, 255])
    expect(pixelAt(sheetOfGroup(replay, skinPath, 0, 1), 0, 0)).toEqual([0, 0, 255, 255])
    expect(pixelAt(sheetOfGroup(replay, katarPath, 0), 0, 0)).toEqual([0, 255, 0, 255])
  })

  test("composes a player's skin sheets once for all their looks", async () => {
    const { replay } = await loaded()

    // the body and arm sheets in two colourings, and the katar's in one
    expect(replay.groups.map((group) => group.url)).toEqual([skinPath, ownPath, katarPath, skinPath])

    const before = composedSheets()

    await loaded()

    // player 1's body and arm sheets, player 2's, and the katar's: seven were the looks composed one by one
    expect(composedSheets() - before).toBe(5)
  })

  test('lets the decoded sheets go once composed', async () => {
    const decoded: FakeBitmap[] = []
    const decode = globalThis.createImageBitmap

    Object.assign(globalThis, {
      createImageBitmap: async (blob: Blob) => {
        const bitmap = (await decode(blob)) as unknown as FakeBitmap

        decoded.push(bitmap)

        return bitmap
      },
    })

    try {
      await loaded()
    } finally {
      Object.assign(globalThis, { createImageBitmap: decode })
    }

    // the format 3 sheet is drawn as it decodes; the six weighted ones are composed and closed
    expect(decoded.filter((bitmap) => bitmap.closed)).toHaveLength(6)
  })

  test('counts the sets’ sheets into the progress, as the set files give their sizes', async () => {
    const progress: { loaded: number; total: number }[] = []
    const store = stubStore(manifestOf())

    const replay = await loadReplay(manifestUrl, {
      baseUrl: artUrl,
      fetch: store.fetch,
      onProgress: (p) => progress.push(p),
    })

    await replay.loaded

    // the match's own sheet, and three weighted sheets of 100 bytes with a weight sheet of 10
    expect(progress.at(-1)).toMatchObject({ loaded: 430, total: 430 })
  })
})

describe("a player's readiness", () => {
  // the katar look draws the arm from the katar's sheet: once it's let go, only the unarmed look is ready
  async function withoutKatarSheet() {
    const { replay } = await loaded()
    const katar = replay.groups.find((group) => group.url === katarPath)

    if (katar) katar.sheets[0] = undefined

    return { replay, player: replay.players.get('1') }
  }

  test('checks every look when none is named', async () => {
    const { replay, player } = await withoutKatarSheet()

    expect(player && isReady(replay, player, ARM_ANIMATION)).toBe(false)
  })

  test('checks only the look its index names', async () => {
    const { replay, player } = await withoutKatarSheet()

    expect(player && isReady(replay, player, ARM_ANIMATION, '0')).toBe(true)
    expect(player && isReady(replay, player, ARM_ANIMATION, '1')).toBe(false)
  })
})

describe('a player whose art cannot load', () => {
  test('is missing when a set fails, and the others still draw', async () => {
    const manifest = manifestOf()

    manifest.players['2'].art = [katarPath, 'art/dddddddddddddddddddddddddddddddd.json', ownPath]

    const { replay } = await loaded(manifest)

    expect(replay.players.get('2')?.missing?.message).toBe(
      `load replay file ${artUrl}art/dddddddddddddddddddddddddddddddd.json: HTTP 404`,
    )

    expect(replay.players.get('1')?.missing).toBeUndefined()
    expect(drawn(replay, '2', poseOf({}))).toEqual([])
    expect(drawn(replay, '1', poseOf({})).length).toBe(1)
  })

  test('is missing when a weight sheet the first seconds draw fails, and loadReplay still resolves', async () => {
    const { replay } = await loaded(manifestOf(), { missing: [bodyWeights] })

    expect(replay.players.get('1')?.missing?.message).toBe(`load replay file ${artUrl}${bodyWeights}: HTTP 404`)
    expect(replay.players.get('2')?.missing?.message).toBe(`load replay file ${artUrl}${bodyWeights}: HTTP 404`)
  })

  test('is missing when a sheet fails after the first seconds, and replay.loaded still resolves', async () => {
    const { replay } = await loaded(manifestOf(), { missing: [katarSheet] })

    expect(replay.players.get('1')?.missing?.message).toBe(`load replay file ${artUrl}${katarSheet}: HTTP 404`)
    expect(replay.players.get('2')?.missing).toBeUndefined()
    const player = replay.players.get('1')

    expect(player && isReady(replay, player, BODY_ANIMATION)).toBe(false)
  })

  test('draws nothing and has nothing to wait for', async () => {
    const { replay } = await loaded(manifestOf(), { missing: [katarSheet] })
    const sheets: unknown[] = []
    const player = replay.players.get('1')

    const isWhole =
      player && drawPlayer(contextDrawingInto(sheets), replay, player, poseOf({ look: 1 }), [1, 0, 0, 1, 0, 0])

    expect(isWhole).toBe(true)
    expect(sheets).toEqual([])
  })

  test('is told of once, at load and mid-match, with why', async () => {
    const manifest = manifestOf()
    const told: [string, string][] = []

    manifest.players['2'].art = [katarPath, 'art/dddddddddddddddddddddddddddddddd.json', ownPath]

    const store = stubStore(manifest, { missing: [katarSheet, katarWeights] })

    const replay = await loadReplay(manifestUrl, {
      baseUrl: artUrl,
      fetch: store.fetch,
      onMissing: (slot, error) => told.push([slot, error.message]),
    })

    await replay.loaded

    expect(told).toEqual([
      ['2', `load replay file ${artUrl}art/dddddddddddddddddddddddddddddddd.json: HTTP 404`],
      ['1', `load replay file ${artUrl}${katarSheet}: HTTP 404`],
    ])
  })

  test('is not ready once marked missing, though an animation was ready before', async () => {
    const { replay } = await loaded()
    const player = replay.players.get('1')

    expect(player && isReady(replay, player, BODY_ANIMATION)).toBe(true)

    if (player) player.missing = new Error('a sheet failed')

    expect(player && isReady(replay, player, BODY_ANIMATION)).toBe(false)
  })

  test('has no more of their sheets fetched', async () => {
    // both players draw the body, so both are missing once its weights fail: no one draws the rest
    const { store } = await loaded(manifestOf(), { missing: [bodyWeights] })

    expect(store.sheetsFetched().sort()).toEqual([bodySheet, bodyWeights].sort())
  })

  test('fails the whole replay in format 3, as it always did', async () => {
    const manifest = {
      ...manifestOf(),
      format: 3,
      players: { '1': { ...playerOf(1, []), art: [ownPath], startAnimations: [] } },
    } as unknown as Manifest

    const store = stubStore(manifest, { missing: [ownSheet] })
    const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch: store.fetch })

    await expect(replay.loaded).rejects.toThrow(`load replay file ${artUrl}${ownSheet}: HTTP 404`)
  })
})

type DrawnSheet = FakeBitmap

// contextDrawingInto is a 2D context that records the sheets drawn from
function contextDrawingInto(sheets: unknown[]): CanvasRenderingContext2D {
  return {
    save() {},
    restore() {},
    setTransform() {},
    globalAlpha: 1,
    drawImage: (sheet: unknown) => sheets.push(sheet),
  } as unknown as CanvasRenderingContext2D
}

// drawn is the sheets drawPlayer draws a pose from
function drawn(replay: Replay, slot: string, pose: PlayerPose): DrawnSheet[] {
  const sheets: DrawnSheet[] = []
  const player = replay.players.get(slot)

  if (player) drawPlayer(contextDrawingInto(sheets), replay, player, pose, [1, 0, 0, 1, 0, 0])

  return sheets
}

function poseOf(pose: Partial<PlayerPose>): PlayerPose {
  return { animationIndex: ARM_ANIMATION, frame: 0, facingRight: true, x: 0, y: 0, weapon: 'Unarmed', ...pose }
}

describe('drawing a player in a look', () => {
  test.each([
    ['the look its index names', { look: 1 }, katarPath],
    ['the look for the weapon held without an index', { weapon: 'Katar' }, katarPath],
    ['the look for the weapon held when no look has the index', { look: 7, weapon: 'Katar' }, katarPath],
    ['the first look for a weapon no look has', { weapon: 'Spear' }, skinPath],
    ['the unarmed look by its index', { look: 0, weapon: 'Katar' }, skinPath],
  ])('draws %s', async (_, pose, url) => {
    const { replay } = await loaded()
    const sheets = drawn(replay, '1', poseOf(pose))

    expect(sheets).toEqual([sheetOfGroup(replay, url, url === skinPath ? 1 : 0)])
  })

  test('draws each weapon a look index is shown with in its own manifest look', async () => {
    // the line lists one look for two weapons whose skins look the same, and the manifest has a look for each
    const manifest = manifestOf()
    const withBow: ManifestLook = { ...withKatar, weapon: 'Bow', art: [1, 2] }

    manifest.players['1'].looks = [unarmed, withKatar, withBow]

    const { replay } = await loaded(manifest)

    expect(drawn(replay, '1', poseOf({ look: 1, weapon: 'Katar' }))).toEqual([sheetOfGroup(replay, katarPath, 0)])
    expect(drawn(replay, '1', poseOf({ look: 1, weapon: 'Bow' }))).toEqual([sheetOfGroup(replay, skinPath, 1)])
    expect(drawn(replay, '1', poseOf({ look: 1, weapon: 'Spear' }))).toEqual([sheetOfGroup(replay, katarPath, 0)])
  })

  test("takes a bone's whole row from the first set that has it", async () => {
    const { replay } = await loaded()
    const katarLook = replay.players.get('1')?.sets.get('1')
    const arm = katarLook?.nameId('a_Arm') ?? -1

    // the katar's set holds one frame of the arm; the skin's second frame isn't a candidate
    expect(
      [...(katarLook?.pieces('', arm) ?? [])].map((ref) => (ref < 0 ? ref : replay.groups[groupOf(ref)].url)),
    ).toEqual([katarPath, -1])

    expect(katarLook?.tail('', arm)?.[1]).toBe(-1)
  })
})

// A tiny synthetic art store for the loader's tests: one player whose body bone shows a piece on a start sheet in the
// first seconds' animation (0) and a piece on a background sheet in an animation only the rest pack has (1). The
// background sheet is held back until release() is called, so a test can look at the replay while it's pending
import type { Manifest } from '..'
import { writePack } from './pack-writer.ts'

export const artUrl = 'https://art.test/'
export const manifestUrl = 'https://brawltome.test/matches/abc/manifest.json'

const groupPath = 'art/11111111111111111111111111111111.json'
const startPackPath = 'anims/2222222222222222.bin'
const restPackPath = 'anims/3333333333333333.bin'

export const startSheetPath = 'sheets/4444444444444444.webp'
export const backgroundSheetPath = 'sheets/5555555555555555.webp'

export const startAnimation = 0
export const restAnimation = 1

const manifest = {
  format: 3,
  replay: 'match.replay',
  patch: '11.00',
  map: { id: 135, name: 'Demon Island', layout: 'maps/66666666666666666666666666666666.json' },
  animations: [
    ['a__BodyAnimation', 'Ready'],
    ['a__BodyAnimation', 'Run'],
  ],
  objectAnimations: [],
  start: { from: 0, to: 94 },
  sheetOrder: [startSheetPath, backgroundSheetPath],
  players: {
    '1': {
      slot: 1,
      name: 'Player',
      legend: { id: 3, name: 'Bodvar' },
      look: { skin: 0, colorScheme: 0, weaponSkins: [] },
      art: [groupPath],
      start: startPackPath,
      rest: restPackPath,
      startAnimations: [startAnimation],
    },
  },
  bytes: {},
} as unknown as Manifest

// the body bone shows piece 0 (on the start sheet) at sprite frame 0, and piece 1 (on the background sheet) at 1
const group = {
  format: 3,
  sheets: [
    { src: startSheetPath, w: 8, h: 8, bytes: 10 },
    { src: backgroundSheetPath, w: 8, h: 8, bytes: 10 },
  ],
  pieces: [
    [0, 0, 0, 8, 8, 0, 0, 8, 8],
    [1, 0, 0, 8, 8, 0, 0, 8, 8],
  ],
  bones: { a_Body: [0, 1] },
  weapons: {},
}

const bodyAt = (spriteFrame: number) => ({ name: 'a_Body', spriteFrame, opacity: 1, matrix: [1, 0, 0, 1, 0, 0] })

const startPack = writePack([{ index: startAnimation, frameCount: 1, frames: new Map([[0, [bodyAt(0)]]]) }])
const restPack = writePack([{ index: restAnimation, frameCount: 1, frames: new Map([[0, [bodyAt(1)]]]) }])

// stubArtStore serves the store, records every url asked for, and holds the background sheet until release()
export function stubArtStore() {
  const urls: string[] = []
  let release = () => {}

  const backgroundSheetSent = new Promise<void>((resolve) => {
    release = resolve
  })

  const files = new Map<string, () => Response | Promise<Response>>([
    [manifestUrl, () => Response.json(manifest)],
    [`${artUrl}${groupPath}`, () => Response.json(group)],
    [`${artUrl}${startPackPath}`, () => new Response(startPack)],
    [`${artUrl}${restPackPath}`, () => new Response(restPack)],
    [`${artUrl}${startSheetPath}`, () => new Response(new Blob(['start sheet']))],
    [`${artUrl}${backgroundSheetPath}`, () => backgroundSheetSent.then(() => new Response(new Blob(['background'])))],
  ])

  const fetch = async (url: string) => {
    urls.push(url)

    return (await files.get(url)?.()) ?? new Response(null, { status: 404 })
  }

  return { urls, fetch, release: () => release() }
}

// bun has no createImageBitmap; the loader only keeps what it returns
export function stubImageBitmaps() {
  const decode = async () => ({ width: 8, height: 8, close() {} }) as unknown as ImageBitmap

  Object.assign(globalThis, { createImageBitmap: decode })
}

import { createHash } from 'node:crypto'

// a made-up export in the brawlhalla-anims format 3 (packages/replay-player/src/format.ts): what the replay worker
// uploads for one match, with files small enough to read

export type ArtNames = {
  groups: [string, string, string]
  map: string
  sheets: [string, string]
  packs: [string, string, string]
}

const fixedNames: ArtNames = {
  groups: [`art/${'1'.repeat(32)}.json`, `art/${'2'.repeat(32)}.json`, `art/${'3'.repeat(32)}.json`],
  map: `maps/${'4'.repeat(32)}.json`,
  sheets: ['sheets/5555555555555555.webp', 'sheets/6666666666666666.webp'],
  packs: ['anims/7777777777777777.bin', 'anims/8888888888888888.bin', 'anims/9999999999999999.bin'],
}

/** A format 3 manifest naming one file of each kind for a player and the objects. */
export function fakeManifest(names: ArtNames = fixedNames) {
  const [playerGroup, weaponGroup, objectGroup] = names.groups
  const [background, sheet] = names.sheets
  const [playerStart, playerRest, objectStart] = names.packs

  return {
    format: 3,
    replay: 'job.replay',
    patch: '11.00',
    map: { id: 136, name: 'Big Crystal Temple', layout: names.map },
    background: { asset: background, width: 100, height: 50 },
    animations: [['a__Imugi', 'Idle']],
    objectAnimations: [],
    start: { from: 375, to: 600 },
    sheetOrder: [sheet, background],
    players: {
      '1': {
        slot: 1,
        name: 'Alpha',
        legend: { id: 65, name: 'IMUGI' },
        look: { skin: 0, colorScheme: 0, weaponSkins: [] },
        art: [playerGroup, weaponGroup],
        start: playerStart,
        rest: playerRest,
        startAnimations: [0],
      },
    },
    objects: { art: [objectGroup], artByLook: { '-': [0] }, start: objectStart, startAnimations: [] },
    bytes: { [playerGroup]: 12, [sheet]: 16 },
  }
}

/** The same match's manifest in format 4: its player in one look, drawn from both of its art groups. */
export function fakeManifestFormat4(names: ArtNames = fixedNames) {
  const manifest = fakeManifest(names)
  const player = manifest.players['1']
  const looks = [{ weapon: 'Fists', look: 0, art: [0, 1], swaps: [[0xff0000, 0x00ff00, 2]] }]

  return { ...manifest, format: 4, players: { '1': { ...player, looks } } }
}

const bounds = { x: -100, y: 0, width: 3000, height: 1600 }

/** A stage with one floor, in the shape the map file carries it. */
export const fakeLayout = {
  camera: bounds,
  killBounds: { x: -1000, y: -1000, width: 5000, height: 3600 },
  collisions: [{ fromX: 200, fromY: 900, toX: 2600, toY: 900, isSoft: false }],
  art: [],
  background: null,
}

function webp(body: string): Uint8Array {
  return new TextEncoder().encode(`RIFF\0\0\0\0WEBP${body}`)
}

function nameOf(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 16)
}

/** Every file of a fake export, named the way the export names them, and the manifest that names them. */
export function fakeArtExport(seed = 'one') {
  const files = new Map<string, Uint8Array>()
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

  const groups = fixedNames.groups.map((path) => {
    files.set(path, json({ format: 3, sheets: [], pieces: [], bones: {}, weapons: {} }))

    return path
  }) as ArtNames['groups']

  const sheets = ['background', 'sheet'].map((body) => {
    const bytes = webp(`${body}-${seed}`)
    const path = `sheets/${nameOf(bytes)}.webp`

    files.set(path, bytes)

    return path
  }) as ArtNames['sheets']

  const packs = ['player-start', 'player-rest', 'object-start'].map((body) => {
    const bytes = new TextEncoder().encode(`${body}-${seed}`)
    const path = `anims/${nameOf(bytes)}.bin`

    files.set(path, bytes)

    return path
  }) as ArtNames['packs']

  // the map file names the background and a platform's art, so it comes after the sheets, as the worker sends it
  const [background, platform] = sheets

  const mapFile = {
    format: 3,
    mapId: 136,
    patch: '11.00',
    background: { asset: background },
    artAssets: { 'Test.Plat.png': platform },
    layout: fakeLayout,
  }

  files.set(fixedNames.map, json(mapFile))

  const manifest = fakeManifest({ groups, map: fixedNames.map, sheets, packs })

  return { files, manifest, mapPath: fixedNames.map }
}

/** A patch's set index in the brawlhalla-anims format, naming its first set for a skin and its last for a class. */
export function fakeSetIndex(patch: string, sets: string[], format = 4) {
  return {
    format,
    drawing: 1,
    pixelsPerUnit: 1.2,
    patch,
    game: '0'.repeat(64),
    skins: { '1': sets[0], '2': 'nothing to draw' },
    weaponSkins: { '3': 'draw per look' },
    classes: { Unarmed: { Idle: { set: sets[sets.length - 1], bones: ['a_Body'] } } },
  }
}

/**
 * Every file of a fake predraw of a patch, in the order the worker sends them: the sets' sheets, then the two set files
 * (a skin's with a weighted sheet, a class's with a plain one), then the index naming them, in the given set format.
 */
export function fakeSetsExport(patch = '11.00', seed = 'one', format = 4) {
  const files = new Map<string, Uint8Array>()
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

  const sheet = (body: string) => {
    const bytes = webp(`${body}-${seed}`)
    const path = `sheets/${nameOf(bytes)}.webp`

    files.set(path, bytes)

    return path
  }

  const [base, weights, plain] = [sheet('base'), sheet('weights'), sheet('plain')]

  // a set is named by its recipe, which the seed stands for
  const sets = ['skin', 'class'].map(
    (kind) => `art/${createHash('sha256').update(`${kind}-${seed}`).digest('hex').slice(0, 32)}.json`,
  )

  const setFile = (kind: string, sheets: unknown) =>
    json({ format: 4, sheets, pieces: [], bones: {}, weapons: {}, set: { kind, drawing: 1 } })

  files.set(
    sets[0] as string,
    setFile('skin', [{ src: base, w: 4, h: 4, bytes: 10, weights: [{ src: weights, bytes: 8 }] }]),
  )

  files.set(sets[1] as string, setFile('class', [{ src: plain, w: 4, h: 4, bytes: 10 }]))

  const indexBytes = json(fakeSetIndex(patch, sets, format))
  const indexPath = `sets/${createHash('sha256').update(indexBytes).digest('hex').slice(0, 32)}.json`

  files.set(indexPath, indexBytes)

  return { files, sets, sheets: [base, weights, plain], indexPath }
}

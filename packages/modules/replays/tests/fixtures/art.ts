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

  files.set(fixedNames.map, json({ format: 3, mapId: 136, patch: '11.00' }))

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

  const manifest = fakeManifest({ groups, map: fixedNames.map, sheets, packs })

  return { files, manifest, mapPath: fixedNames.map }
}

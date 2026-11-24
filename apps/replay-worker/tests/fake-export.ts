// stands in for the brawlhalla-anims export (`export.ts plan|render|warm|predraw`, see its README) in tests. The
// line's `fake` field says what to do: ok (the default), no-animations, bad-plan, crash-render, hang-render. A warm for
// patch 11.01 never ends, one for 11.02 lists a path outside the store, and ones for 11.03 and 11.04 leave a level
// out, 11.04 with a very long reason. A predraw names three sets; its draw for 11.01 draws the first and never ends,
// and the one for 11.03 fails the last. With --sets, plan and render name every set of the index. It writes files named
// the way the export names them, with tiny bodies
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

export const fakeGroups = [`art/${'1'.repeat(32)}.json`, `art/${'2'.repeat(32)}.json`]
export const fakeMap = `maps/${'4'.repeat(32)}.json`
export const fakeMapId = 136
export const warmGroup = `art/${'5'.repeat(32)}.json`
export const warmMaps = [`maps/${'6'.repeat(32)}.json`, `maps/${'7'.repeat(32)}.json`]
// what the export's warm writes to stderr for a level it can't read
export const warmSkip = 'warning: warm: Brawlhaven (map 7) is left out: read level layout: Bare.png has no W or H'
// the same with a reason far longer than the worker logs
export const longWarmSkip = `warning: warm: Brawlhaven (map 7) is left out: read level layout: ${'x'.repeat(600)}`
// a warning from a step that then fails, which the worker must not log as one
export const warningBeforeFailure = 'warning: map 136: no Bare.png in the game folder, its pieces are left out'

const warmSkipOfPatch: Record<string, string> = { '11.03': warmSkip, '11.04': longWarmSkip }

// the sets a predraw names: a skin's, a weapon skin's and a class's
export const fakeSets = [`art/${'a'.repeat(32)}.json`, `art/${'b'.repeat(32)}.json`, `art/${'c'.repeat(32)}.json`]

/** The set index predraw name writes for a patch, and its store path. */
export function fakeSetIndex(patch: string): { path: string; text: string } {
  const [skinSet, weaponSkinSet, classSet] = fakeSets

  const index = {
    format: 4,
    drawing: 1,
    pixelsPerUnit: 1.2,
    patch,
    game: '0'.repeat(64),
    skins: { '1': skinSet, '2': 'nothing to draw' },
    weaponSkins: { '3': weaponSkinSet, '4': 'draw per look' },
    classes: { Unarmed: { Idle: { set: classSet, bones: ['a_Body'] } } },
  }

  const text = JSON.stringify(index)

  return { path: `sets/${createHash('sha256').update(text).digest('hex').slice(0, 32)}.json`, text }
}

/** A set's two sheets, the base and its weights, named by their content. */
export function fakeSetSheets(path: string): { path: string; bytes: Uint8Array }[] {
  return [fakeSheet(`${path} base`), fakeSheet(`${path} weights`)]
}

/** The sheet the fake draws an art group or map on, named by its content as the export names it. */
export function fakeSheet(path: string): { path: string; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode(`RIFF\0\0\0\0WEBP${path}`)

  return { path: `sheets/${sha1Name(bytes)}.webp`, bytes }
}

/** The animation pack every fake render writes. */
export function fakePack(): { path: string; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode('pack')

  return { path: `anims/${sha1Name(bytes)}.bin`, bytes }
}

function sha1Name(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 16)
}

if (import.meta.main) await main()

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      have: { type: 'string' },
      manifest: { type: 'string' },
      patch: { type: 'string' },
      list: { type: 'boolean' },
      index: { type: 'string' },
      sets: { type: 'string' },
      check: { type: 'boolean' },
    },
  })

  if (positionals[0] === 'predraw') return predraw(positionals.slice(1), values)

  const [command, gameFolder = ''] = positionals

  if (!existsSync(gameFolder)) fail(`no game folder ${gameFolder}`)

  // warm <game folder> <store>; plan and render <game folder> <line> [<store>]
  if (command === 'warm') return warm(positionals[2] ?? '', values)

  const [linePath = '', store = ''] = positionals.slice(2)

  const line = JSON.parse(readFileSync(linePath, 'utf8').split('\n')[0] ?? '{}') as { fake?: string }

  if (line.fake === 'no-animations') {
    console.error(warningBeforeFailure)
    console.error('no animations in the line')
    process.exit(2)
  }

  const sets = values.sets ? setsOf(values.sets) : null

  if (command === 'plan') return plan(basename(gameFolder), line.fake === 'bad-plan', sets)

  if (line.fake === 'crash-render') {
    console.error(warningBeforeFailure)
    fail('boom')
  }

  if (line.fake === 'hang-render') await new Promise(() => undefined)

  render(store, values.have ?? '', values.manifest ?? '', sets)
}

function plan(patch: string, isBad: boolean, sets: string[] | null): void {
  const paths = isBad ? [...fakeGroups, '../../outside.json'] : fakeGroups
  const groups = paths.map((path) => ({ fingerprint: path.slice(4, 36), path, kind: 'core' }))
  const map = { fingerprint: '4', path: fakeMap }

  console.log(JSON.stringify({ format: 3, patch, mapId: fakeMapId, groups, map, ...(sets ? { sets } : {}) }))
}

// every set an index names, as plan and render with --sets name them
function setsOf(indexFile: string): string[] {
  const index = JSON.parse(readFileSync(indexFile, 'utf8')) as { skins: Record<string, string> }

  if (!index.skins) fail(`${indexFile} is not a set index`)

  return fakeSets
}

// writes what --have lacks, as the export does, and reads what it has, so a store missing one of those fails
function render(store: string, haveFile: string, manifestPath: string, sets: string[] | null): void {
  const have = readHave(haveFile)

  for (const path of have) {
    if (!existsSync(join(store, path))) fail(`the store lacks ${path}, which --have lists`)
  }

  for (const path of [...fakeGroups, fakeMap].filter((path) => !have.has(path))) writeDrawn(store, path)

  const pack = fakePack()

  write(store, pack.path, pack.bytes)

  const manifest = sets
    ? { format: 4, map: { layout: fakeMap }, art: [...sets, ...fakeGroups] }
    : { format: 3, map: { layout: fakeMap }, art: fakeGroups }

  writeFileSync(manifestPath, JSON.stringify(manifest))
  console.log(`${store}: wrote some files`)
}

async function warm(store: string, values: { have?: string; patch?: string; list?: boolean }): Promise<void> {
  const have = readHave(values.have)
  const paths = warmListOf(values.patch).filter((path) => !have.has(path))

  // the level it leaves out is said by the list and by the warm itself, as the export says it
  const skip = warmSkipOfPatch[values.patch ?? '']

  if (skip) console.error(skip)

  if (values.list) {
    for (const path of paths) console.log(path)

    return
  }

  // a warm that never ends, for the tests of its timeout
  if (values.patch === '11.01') await new Promise(() => undefined)

  // the export's progress goes to stderr, a line a legend and then the totals
  console.error(`Bodvar: ${paths.length} art groups (0.1 s)`)

  for (const path of paths) console.log(...writeDrawn(store, path, values.patch))

  console.error(`${store}: wrote ${paths.length} files, ${have.size} given, 0 s`)
}

// predraw name <game folder> --patch <version> --index <file>; predraw draw <game folder> <store> --index <file>
// --have <file> [--check]
async function predraw(args: string[], values: { patch?: string; index?: string; have?: string }): Promise<void> {
  const [subcommand, gameFolder = '', store = ''] = args

  if (!existsSync(gameFolder)) fail(`no game folder ${gameFolder}`)

  if (!values.index) fail('predraw needs --index')

  if (subcommand === 'name') {
    const index = fakeSetIndex(values.patch ?? '')

    writeFileSync(values.index, index.text)
    console.log(index.path)

    return
  }

  const have = readHave(values.have)
  const patch = basename(gameFolder)
  const toDraw = fakeSets.filter((path) => !have.has(path))
  const failed: string[] = []

  for (const [position, path] of toDraw.entries()) {
    if (patch === '11.03' && position === toDraw.length - 1) {
      failed.push(path)
      continue
    }

    drawSet(store, path)

    // a draw that never ends, once it drew one set whole
    if (patch === '11.01') await new Promise(() => undefined)
  }

  for (const path of failed) console.log(`failed ${path} a piece needs 24 colours`)

  if (failed.length > 0) process.exit(3)
}

// a set's sheets first and its file last, as predraw draws them, so a set file means a whole set
function drawSet(store: string, path: string): void {
  const sheets = fakeSetSheets(path)

  for (const sheet of sheets) {
    write(store, sheet.path, sheet.bytes)
    console.log(sheet.path)
  }

  const [base, weights] = sheets.map((sheet) => sheet.path)
  const sheetRows = [{ src: base, w: 4, h: 4, bytes: 10, weights: [{ src: weights, bytes: 8 }] }]
  const body = { format: 4, sheets: sheetRows, pieces: [], bones: {}, weapons: {}, set: { kind: 'skin', drawing: 1 } }

  write(store, path, new TextEncoder().encode(JSON.stringify(body)))
  console.log(path)
}

function warmListOf(patch: string | undefined): string[] {
  if (patch === '11.02') return [warmGroup, '../../outside.json']

  if (patch !== undefined && patch in warmSkipOfPatch) return [warmGroup, ...warmMaps.slice(0, 1)]

  return [warmGroup, ...warmMaps]
}

// an art group or map file and its sheet; a map file says its id and patch, as the export's do
function writeDrawn(store: string, path: string, patch = '11.00'): string[] {
  const sheet = fakeSheet(path)
  const mapId = path === fakeMap ? fakeMapId : Number.parseInt(path.slice(5, 6), 16)
  const body = path.startsWith('maps/') ? { mapId, patch, background: sheet.path } : { sheets: [sheet.path] }

  write(store, path, new TextEncoder().encode(JSON.stringify(body)))
  write(store, sheet.path, sheet.bytes)

  return [path, sheet.path]
}

function write(store: string, path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(join(store, path)), { recursive: true })
  writeFileSync(join(store, path), bytes)
}

function readHave(haveFile: string | undefined): Set<string> {
  if (!haveFile) return new Set()

  return new Set(readFileSync(haveFile, 'utf8').split('\n').filter(Boolean))
}

function fail(message: string): never {
  console.error(`export: ${message}`)
  process.exit(1)
}

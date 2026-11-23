// stands in for the brawlhalla-anims export (`export.ts plan|render|warm`, see its README) in tests. The line's
// `fake` field says what to do: ok (the default), no-animations, bad-plan, crash-render, hang-render. A warm for
// patch 11.01 never ends, one for 11.02 lists a path outside the store, and ones for 11.03 and 11.04 leave a level
// out, 11.04 with a very long reason. It writes files named the way the export names them, with tiny bodies
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
    },
  })

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

  if (command === 'plan') return plan(basename(gameFolder), line.fake === 'bad-plan')

  if (line.fake === 'crash-render') {
    console.error(warningBeforeFailure)
    fail('boom')
  }

  if (line.fake === 'hang-render') await new Promise(() => undefined)

  render(store, values.have ?? '', values.manifest ?? '')
}

function plan(patch: string, isBad: boolean): void {
  const paths = isBad ? [...fakeGroups, '../../outside.json'] : fakeGroups
  const groups = paths.map((path) => ({ fingerprint: path.slice(4, 36), path, kind: 'core' }))

  console.log(JSON.stringify({ format: 3, patch, mapId: fakeMapId, groups, map: { fingerprint: '4', path: fakeMap } }))
}

// writes what --have lacks, as the export does, and reads what it has, so a store missing one of those fails
function render(store: string, haveFile: string, manifestPath: string): void {
  const have = readHave(haveFile)

  for (const path of have) {
    if (!existsSync(join(store, path))) fail(`the store lacks ${path}, which --have lists`)
  }

  for (const path of [...fakeGroups, fakeMap].filter((path) => !have.has(path))) writeDrawn(store, path)

  const pack = fakePack()

  write(store, pack.path, pack.bytes)
  writeFileSync(manifestPath, JSON.stringify({ format: 3, map: { layout: fakeMap }, art: fakeGroups }))
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

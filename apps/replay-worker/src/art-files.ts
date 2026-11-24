import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ArtMap } from './art-client'

// one art job's files under the work folder, all named after the job so they go together: the line, the --have list,
// the manifest, the patch's set index, and a store folder in the export's layout holding what the job downloaded and
// what the export wrote

export type JobFiles = { line: string; have: string; manifest: string; index: string; store: string }

// the folders the export writes into a store, in the order their files are sent: a file after the files it names, as
// the api refuses a map file or a set whose sheets it doesn't hold yet. a set index goes last of all
const STORE_FOLDERS = ['sheets', 'anims', 'art', 'maps', 'sets']

// a file in a store, as the export names it; checked before the worker reads or writes any path it was handed
const STORE_PATH = /^(art|maps|sheets|anims|sets)\/[0-9a-f]+\.(json|webp|bin)$/

const SET_INDEX_PATH = /^sets\/[0-9a-f]{32}\.json$/

export function isStorePath(path: string): boolean {
  return STORE_PATH.test(path)
}

/** Whether a path names a patch's set index, `sets/<32 hex digits of its sha256>.json`. */
export function isSetIndexPath(path: string): boolean {
  return SET_INDEX_PATH.test(path)
}

export function jobFiles(artDir: string, jobId: string): JobFiles {
  return {
    line: join(artDir, `${jobId}.line`),
    have: join(artDir, `${jobId}.have`),
    manifest: join(artDir, `${jobId}.manifest.json`),
    index: join(artDir, `${jobId}.sets.json`),
    store: join(artDir, `${jobId}.store`),
  }
}

/** Deletes everything named after the job. */
export function removeJobFiles(artDir: string, jobId: string): void {
  if (!existsSync(artDir)) return

  for (const name of readdirSync(artDir)) {
    if (name.startsWith(jobId)) rmSync(join(artDir, name), { recursive: true, force: true })
  }
}

/** Writes the paths the bucket already holds, one a line, as the export reads --have. */
export function writeHave(files: JobFiles, paths: string[]): void {
  writeFileSync(files.have, paths.map((path) => `${path}\n`).join(''))
}

export function writeStoreFile(store: string, path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(join(store, path)), { recursive: true })
  writeFileSync(join(store, path), bytes)
}

/** Every file in the store, by its path in the bucket (`sheets/<hash>.webp`). */
export function listStore(store: string): string[] {
  return STORE_FOLDERS.flatMap((folder) => {
    const folderPath = join(store, folder)

    if (!existsSync(folderPath)) return []

    return readdirSync(folderPath)
      .map((name) => `${folder}/${name}`)
      .filter(isStorePath)
  })
}

/** The map files in the store, each with the map id and patch it says it draws. */
export function readStoreMaps(store: string): ArtMap[] {
  return listStore(store)
    .filter((path) => path.startsWith('maps/'))
    .map((path) => {
      const map = JSON.parse(readFileSync(join(store, path), 'utf8')) as { mapId: number; patch: string }

      return { patch: map.patch, mapId: map.mapId, path }
    })
}

// the index's words for a row that needs no set of its own
const NOT_A_SET = ['nothing to draw', 'draw per look']

/**
 * Every set a patch's set index names, once each (SetIndex in the export's src/format.ts: by skin, by weapon skin, and
 * by class and animation), or null when the file isn't an index or names a set outside the store layout.
 */
export function readIndexSets(indexFile: string): string[] | null {
  let index: unknown

  try {
    index = JSON.parse(readFileSync(indexFile, 'utf8'))
  } catch {
    return null
  }

  if (!isRecord(index) || !isRecord(index.skins) || !isRecord(index.weaponSkins) || !isRecord(index.classes)) {
    return null
  }

  const names = [...Object.values(index.skins), ...Object.values(index.weaponSkins), ...classSetNames(index.classes)]
  const sets = names.filter((name) => !NOT_A_SET.includes(name as string))

  if (!sets.every(isSetPath)) return null

  return [...new Set(sets)]
}

// each class set's name; anything that isn't { class: { animation: { set } } } gives a null, which isn't a set
function classSetNames(classes: Record<string, unknown>): unknown[] {
  const names: unknown[] = []

  for (const animations of Object.values(classes)) {
    if (!isRecord(animations)) {
      names.push(null)
      continue
    }

    for (const classSet of Object.values(animations)) names.push(isRecord(classSet) ? classSet.set : null)
  }

  return names
}

function isSetPath(name: unknown): name is string {
  return typeof name === 'string' && name.startsWith('art/') && isStorePath(name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

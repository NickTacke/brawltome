import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ArtMap } from './art-client'

// one art job's files under the work folder, all named after the job so they go together: the line, the --have list,
// the manifest, and a store folder in the export's layout holding what the job downloaded and what the export wrote

export type JobFiles = { line: string; have: string; manifest: string; store: string }

// the folders the export writes into a store
const STORE_FOLDERS = ['art', 'maps', 'sheets', 'anims']

export function jobFiles(artDir: string, jobId: string): JobFiles {
  return {
    line: join(artDir, `${jobId}.line`),
    have: join(artDir, `${jobId}.have`),
    manifest: join(artDir, `${jobId}.manifest.json`),
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

    return readdirSync(folderPath).map((name) => `${folder}/${name}`)
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

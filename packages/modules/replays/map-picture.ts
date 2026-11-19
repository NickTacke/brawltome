import type { ObjectStore, Sql } from '@brawltome/foundation'
import { parseArtPath } from './art-paths'

// a match list shows each map's background, which the map file the art export stored for that patch names. a map
// file is named by its content and never changes, so a picture once found is kept for the life of the process. a map
// not drawn yet, or a bucket that didn't answer, is asked again next time

export type MapPictureDeps = { sql: Sql; artStore: ObjectStore | null; artBaseUrl: string | null }

export type MapRef = { patch: string; mapId: number }

/** The address of each map's background by `mapKey`; a map without one is left out. */
export type MapPictures = (maps: MapRef[]) => Promise<Map<string, string>>

export function mapKey({ patch, mapId }: MapRef): string {
  return `${patch}/${mapId}`
}

export function createMapPictures({ sql, artStore, artBaseUrl }: MapPictureDeps): MapPictures {
  const found = new Map<string, string>()

  async function pictureIn(path: string): Promise<string | null> {
    try {
      const background = backgroundIn(await artStore?.get(path))

      return background ? `${artBaseUrl}/${background}` : null
    } catch (error) {
      console.error(`read the background in map file ${path}:`, error)

      return null
    }
  }

  return async (maps) => {
    const missing = maps.filter((map) => !found.has(mapKey(map)))

    if (artStore && artBaseUrl && missing.length > 0) await findPictures(missing)

    const pictures = new Map<string, string>()

    for (const map of maps) {
      const picture = found.get(mapKey(map))

      if (picture) pictures.set(mapKey(map), picture)
    }

    return pictures
  }

  async function findPictures(maps: MapRef[]): Promise<void> {
    const patches = maps.map((map) => map.patch)
    const mapIds = maps.map((map) => map.mapId)

    const files = await sql<{ patch: string; mapId: number; path: string }[]>`
      SELECT file.patch, file.map_id AS "mapId", file.path
      FROM replays.map_files AS file
      JOIN unnest(${patches}::text[], ${mapIds}::int[]) AS wanted (patch, map_id)
        ON wanted.patch = file.patch AND wanted.map_id = file.map_id
    `

    await Promise.all(
      files.map(async (file) => {
        const picture = await pictureIn(file.path)

        if (picture) found.set(mapKey(file), picture)
      }),
    )
  }
}

// the background is a sheets/<hash>.webp the bucket holds; anything else in the file is ignored, not trusted
export function backgroundIn(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes) return null

  const mapFile = parseJson(bytes)
  const asset = isRecord(mapFile) && isRecord(mapFile.background) ? mapFile.background.asset : null

  if (typeof asset !== 'string' || parseArtPath(asset)?.kind !== 'sheet') return null

  return asset
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import type { ObjectStore, Sql } from '@brawltome/foundation'
import { parseArtPath } from './art-paths'

// a match list shows each map's background, which the map file the art export stored for that patch names. map files
// are named by their content and never change, so a background found once is kept for the life of the process

export type MapPictureDeps = { sql: Sql; artStore: ObjectStore | null; artBaseUrl: string | null }

export type MapPictures = (patch: string, mapId: number) => Promise<string | null>

/** Finds the address of a map's background; null without an art bucket or before the map was drawn. */
export function createMapPictures({ sql, artStore, artBaseUrl }: MapPictureDeps): MapPictures {
  const backgroundByPath = new Map<string, string | null>()

  async function backgroundOf(path: string): Promise<string | null> {
    if (backgroundByPath.has(path)) return backgroundByPath.get(path) ?? null

    const background = backgroundIn(await artStore?.get(path))

    backgroundByPath.set(path, background)

    return background
  }

  return async (patch, mapId) => {
    if (!artStore || !artBaseUrl) return null

    const [mapFile] = await sql<{ path: string }[]>`
      SELECT path FROM replays.map_files WHERE patch = ${patch} AND map_id = ${mapId}
    `

    if (!mapFile) return null

    const background = await backgroundOf(mapFile.path)

    return background ? `${artBaseUrl}/${background}` : null
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

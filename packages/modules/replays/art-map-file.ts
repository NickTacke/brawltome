import { parseArtPath } from './art-paths'

// a map file (maps/<fingerprint>.json) names sheets of its own: the level's background and the platform art the match
// page draws (MapFile in packages/replay-player/src/format.ts). it is stored only when the bucket holds them, so a
// page never asks for a sheet that isn't there

/** Every sheet a map file names, or why they aren't sheet paths. */
export function readMapFileSheets(mapFile: Record<string, unknown>): { paths: string[] } | { reason: string } {
  const background = backgroundSheet(mapFile.background)
  const artAssets = mapFile.artAssets ?? {}

  if (background === 'invalid') return { reason: "the map file's background is not a sheet file path" }

  if (!isRecord(artAssets)) return { reason: "the map file's artAssets is not a json object" }

  const wrong = Object.entries(artAssets).find(([, value]) => !isSheetPath(value))

  if (wrong) return { reason: `the map file's artAssets.${wrong[0]} is not a sheet file path` }

  const paths = [...(background ? [background] : []), ...(Object.values(artAssets) as string[])]

  return { paths: [...new Set(paths)] }
}

// a level may have no background
function backgroundSheet(background: unknown): string | null | 'invalid' {
  if (background === undefined || background === null) return null

  if (!isRecord(background) || !isSheetPath(background.asset)) return 'invalid'

  return background.asset
}

function isSheetPath(value: unknown): value is string {
  return typeof value === 'string' && parseArtPath(value)?.kind === 'sheet'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

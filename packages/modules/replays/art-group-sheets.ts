import { parseArtPath } from './art-paths'

// a format 4 art group (art/<fingerprint>.json), a pre-drawn set or a match's own group beside sets, names its sheets
// and their weight sheets (ArtGroupFormat4 in packages/replay-player/src/format.ts). it is stored only once the bucket
// holds them, so a stored set file means a whole set: predraw sends a set's sheets before its file. format 3 groups
// are stored as they were, unchecked

const SETS_FORMAT = 4

/** Every sheet a format 4 art group names, none for any other group, or why they aren't sheet paths. */
export function readArtGroupSheets(group: Record<string, unknown>): { paths: string[] } | { reason: string } {
  if (group.format !== SETS_FORMAT) return { paths: [] }

  if (!Array.isArray(group.sheets)) return { reason: "the art group's sheets are not a list" }

  const paths: string[] = []

  for (const [index, sheet] of group.sheets.entries()) {
    const sheetPaths = sheetAndWeights(sheet)

    if (!sheetPaths) return { reason: `the art group's sheets.${index} does not name sheet files` }

    paths.push(...sheetPaths)
  }

  return { paths: [...new Set(paths)] }
}

// the sheet's own path and those of its weight sheets, or null when one isn't a sheet path
function sheetAndWeights(sheet: unknown): string[] | null {
  if (!isRecord(sheet) || !isSheetPath(sheet.src)) return null

  if (sheet.weights === undefined) return [sheet.src]

  if (!Array.isArray(sheet.weights)) return null

  const weights = sheet.weights.map((weight) => (isRecord(weight) ? weight.src : null))

  if (!weights.every(isSheetPath)) return null

  return [sheet.src, ...weights]
}

function isSheetPath(value: unknown): value is string {
  return typeof value === 'string' && parseArtPath(value)?.kind === 'sheet'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Checks the manifest and art groups src/load.ts fetches before anything is drawn with them: that their format is one
// this reads, and, in format 4, the shape it adds. A format 3 file is taken as it comes, as it always was
import { MAX_WEIGHT_SHEETS, WEIGHTS_PER_SHEET } from './compose.ts'
import {
  type AnyArtGroup,
  type AnyManifest,
  type ArtGroupFormat4,
  FORMATS,
  SET_FORMAT,
  type SetKind,
} from './format.ts'

const SET_KINDS: readonly SetKind[] = ['skin', 'weaponSkin', 'class']

const LARGEST_COLOR = 0xffffff

// readManifest is a fetched manifest, or an error naming what's wrong with it
export function readManifest(json: unknown, url: string): AnyManifest {
  const format = formatOf(json)

  if (!FORMATS.includes(format as number)) {
    throw new Error(`load replay ${url}: manifest format ${String(format)}, expected ${FORMATS.join(' or ')}`)
  }

  const problem = format === SET_FORMAT ? manifestProblem(json as Record<string, unknown>) : null

  if (problem) throw new Error(`load replay ${url}: manifest ${problem}`)

  return json as AnyManifest
}

// readArtGroup is a fetched art group, or an error naming what's wrong with it
export function readArtGroup(json: unknown, url: string): AnyArtGroup {
  const format = formatOf(json)

  if (!FORMATS.includes(format as number)) {
    throw new Error(`load replay file ${url}: art group format ${String(format)}, expected ${FORMATS.join(' or ')}`)
  }

  const problem = format === SET_FORMAT ? groupProblem(json as Record<string, unknown>) : null

  if (problem) throw new Error(`load replay file ${url}: art group ${problem}`)

  return json as AnyArtGroup
}

function formatOf(json: unknown): unknown {
  return isRecord(json) ? json.format : undefined
}

// manifestProblem is what a format 4 manifest gets wrong beyond format 3's shape, or null
function manifestProblem(manifest: Record<string, unknown>): string | null {
  if (!isRecord(manifest.players)) return 'has no players'

  for (const [slot, player] of Object.entries(manifest.players)) {
    const problem = playerProblem(player)

    if (problem) return `player ${slot} ${problem}`
  }

  return null
}

function playerProblem(player: unknown): string | null {
  if (!isRecord(player) || !Array.isArray(player.art)) return 'has no art'

  if (!Array.isArray(player.looks)) return 'has no looks'

  const groupCount = player.art.length

  for (const [index, look] of player.looks.entries()) {
    const problem = lookProblem(look, groupCount)

    if (problem) return `look ${index} ${problem}`
  }

  return null
}

function lookProblem(look: unknown, groupCount: number): string | null {
  if (!isRecord(look)) return 'is not an object'

  if (typeof look.weapon !== 'string') return 'names no weapon'

  if (look.look !== undefined && !isIndex(look.look)) return `has look ${String(look.look)}, not an index`

  if (!Array.isArray(look.art)) return 'has no art'

  const outside = look.art.find((group) => !isIndex(group) || group >= groupCount)

  if (outside !== undefined) return `draws from art ${String(outside)}, but the player has ${groupCount} groups`

  if (!Array.isArray(look.swaps)) return 'has no swaps'

  const wrongSwap = look.swaps.findIndex((swap) => !isSwap(swap))

  if (wrongSwap >= 0) return `has swap ${wrongSwap}, not [from, to, art type]`

  return null
}

function isSwap(swap: unknown): boolean {
  return Array.isArray(swap) && swap.length === 3 && swap.every((value) => Number.isInteger(value))
}

// groupProblem is what a format 4 group gets wrong beyond format 3's shape, or null
function groupProblem(group: Record<string, unknown>): string | null {
  if (!Array.isArray(group.sheets)) return 'has no sheets'

  if (!Array.isArray(group.pieces)) return 'has no pieces'

  for (const [index, sheet] of group.sheets.entries()) {
    const problem = sheetProblem(sheet)

    if (problem) return `sheet ${index} ${problem}`
  }

  if (group.set !== undefined && !isSetHeader(group.set)) return 'has a set that is not { kind, drawing }'

  if (group.swappable === undefined) return null

  return swappableProblem(group as ArtGroupFormat4, group.swappable)
}

function sheetProblem(sheet: unknown): string | null {
  if (!isRecord(sheet) || typeof sheet.src !== 'string') return 'has no src'

  if (sheet.weights === undefined) return null

  if (!Array.isArray(sheet.weights) || sheet.weights.length === 0) return 'has weights that are not a list of sheets'

  if (sheet.weights.length > MAX_WEIGHT_SHEETS) {
    return `has ${sheet.weights.length} weight sheets, more than ${MAX_WEIGHT_SHEETS}`
  }

  const wrong = sheet.weights.findIndex((weight) => !isWeightSheet(weight))

  if (wrong >= 0) return `has weight sheet ${wrong}, not { src, bytes }`

  return null
}

function isWeightSheet(weight: unknown): boolean {
  return isRecord(weight) && typeof weight.src === 'string' && typeof weight.bytes === 'number'
}

function isSetHeader(set: unknown): boolean {
  return isRecord(set) && SET_KINDS.includes(set.kind as SetKind) && Number.isInteger(set.drawing)
}

// swappableProblem checks each piece's entry: none, or its art type and the colours its sheet keeps weights for
function swappableProblem(group: ArtGroupFormat4, swappable: unknown): string | null {
  if (!Array.isArray(swappable)) return 'has swappable colours that are not a list'

  if (swappable.length !== group.pieces.length) {
    return `has swappable colours for ${swappable.length} pieces, but ${group.pieces.length} pieces`
  }

  for (const [piece, entry] of swappable.entries()) {
    const problem = entryProblem(entry, weightSheetsOf(group, piece))

    if (problem) return `piece ${piece} ${problem}`
  }

  return null
}

function weightSheetsOf(group: ArtGroupFormat4, piece: number): number {
  const sheet = group.sheets[group.pieces[piece]?.[0] ?? -1]

  return sheet?.weights?.length ?? 0
}

function entryProblem(entry: unknown, weightSheets: number): string | null {
  if (!Array.isArray(entry)) return 'has swappable colours that are not a list'

  if (entry.length === 0) return null

  const [artType, ...colors] = entry

  if (!isIndex(artType)) return `has art type ${String(artType)}, not a number`

  if (colors.length === 0) return 'has an art type but no colours'

  const wrongColor = colors.find((color) => !isIndex(color) || color > LARGEST_COLOR)

  if (wrongColor !== undefined) return `has colour ${String(wrongColor)}, not an RGB colour`

  const needed = Math.ceil(colors.length / WEIGHTS_PER_SHEET)

  if (needed > weightSheets) return `keeps ${colors.length} colours, but its sheet has ${weightSheets} weight sheets`

  return null
}

function isIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

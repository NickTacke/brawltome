// The art groups a replay draws with, each in the colours it's drawn in. A format 3 group, or a set without weights,
// is listed once whoever draws it. A set with weighted sheets is listed once per colouring its looks give it: two
// players with one skin in two colour schemes draw the same set file from two groups

import { resolvedColors, type Swap } from './compose.ts'
import type { ColoredPiece } from './compose-sheet.ts'
import { type AnyArtGroup, SET_FORMAT, type SetSheet } from './format.ts'

export type Group = {
  url: string
  json: AnyArtGroup
  // each sheet as drawImage draws it, once loaded: a weighted sheet composed in the group's colours
  sheets: (ImageBitmap | undefined)[]
  // per piece, the colours its weights take in this group; empty for a group without weights
  colors: number[][]
}

export type WeightedSheet = SetSheet & { weights: { src: string; bytes: number }[] }

// isSetGroup says whether a group is a pre-drawn set, which holds far more than one match draws
export function isSetGroup(json: AnyArtGroup): boolean {
  return json.format === SET_FORMAT && json.set !== undefined
}

export function isWeighted(sheet: SetSheet | undefined): sheet is WeightedSheet {
  return sheet?.weights !== undefined && sheet.weights.length > 0
}

// pieceColorsOf is each piece's colours in a look's swaps: those of a piece on a weighted sheet, [] for the rest, or
// an empty list when no sheet has weights
function pieceColorsOf(json: AnyArtGroup, swaps: Swap[]): number[][] {
  if (json.format !== SET_FORMAT || !json.swappable) return []

  const sheets: SetSheet[] = json.sheets

  if (!sheets.some(isWeighted)) return []

  const swappable = json.swappable

  return json.pieces.map((piece, index) => {
    if (!isWeighted(sheets[piece[0]])) return []

    return resolvedColors(swappable[index] ?? [], swaps)
  })
}

const keyOfColors = (colors: number[][]) => colors.map((pieceColors) => pieceColors.join(',')).join(';')

// Groups lists the replay's groups as the players' looks and the objects ask for them
export class Groups {
  readonly list: Group[] = []
  private readonly jsons: Map<string, AnyArtGroup>
  private readonly byKey = new Map<string, number>()

  constructor(jsons: Map<string, AnyArtGroup>) {
    this.jsons = jsons
  }

  // indexOf is the index of a group drawn in a look's swaps, listed when it's first asked for
  indexOf(url: string, swaps: Swap[] = []): number {
    const json = this.jsons.get(url)

    if (!json) throw new Error(`load replay file ${url}: not loaded`)

    const colors = pieceColorsOf(json, swaps)
    const key = colors.length === 0 ? url : `${url}|${keyOfColors(colors)}`
    const known = this.byKey.get(key)

    if (known !== undefined) return known

    this.list.push({ url, json, sheets: json.sheets.map(() => undefined), colors })
    this.byKey.set(key, this.list.length - 1)

    return this.list.length - 1
  }

  jsonOf = (index: number): AnyArtGroup => this.list[index].json
}

// coloredPiecesOf is the pieces on one of a group's sheets, with their colours in the group
export function coloredPiecesOf(group: Group, sheet: number): ColoredPiece[] {
  const pieces: ColoredPiece[] = []

  group.json.pieces.forEach(([pieceSheet, sx, sy, sw, sh], index) => {
    if (pieceSheet === sheet) pieces.push({ sx, sy, sw, sh, colors: group.colors[index] ?? [] })
  })

  return pieces
}

// compositionKeyOf names a sheet in its pieces' colours: groups whose pieces there take the same colours draw the same
// composed sheet
export function compositionKeyOf(src: string, pieces: ColoredPiece[]): string {
  const described = pieces.map((piece) => `${piece.sx},${piece.sy},${piece.sw},${piece.sh}:${piece.colors.join(',')}`)

  return `${src}|${described.join(';')}`
}

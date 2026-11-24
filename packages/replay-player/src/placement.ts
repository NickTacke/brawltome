// Which piece of which art group each draw of an animation shows, and where: the part of src/draw.ts that needs no
// DOM, so it runs outside a browser too
import { type AnyArtGroup, SET_FORMAT } from './format.ts'
import { DRAW_FIELDS, type Pack, type PackedAnimation } from './pack.ts'

// Matrix is [a, b, c, d, e, f], as canvas setTransform takes it: x' = a*x + c*y + e, y' = b*x + d*y + f
export type Matrix = [number, number, number, number, number, number]

export const multiply = (p: Matrix, q: Matrix): Matrix => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
]

// a piece is named by its group (an index into the replay's list of groups) and its index there; each bone's sprite
// frame has up to two, the earlier group's first
const PIECES = 0x10000

export const groupOf = (ref: number) => Math.floor(ref / PIECES)
export const pieceOf = (ref: number) => ref % PIECES
const CANDIDATES = 2

// putPiece adds a piece to a bone's row at a sprite frame, as its first free candidate, growing the row as needed
function putPiece(table: Int32Array[], id: number, frame: number, ref: number) {
  let row = table[id]

  if (!row || row.length < (frame + 1) * CANDIDATES) {
    const grown = new Int32Array((frame + 1) * CANDIDATES).fill(-1)

    if (row) grown.set(row)

    table[id] = row = grown
  }

  putCandidate(row, frame, ref)
}

// putCandidate puts a piece in a row's first free candidate at a sprite frame, unless it's there already
function putCandidate(row: Int32Array, frame: number, ref: number) {
  for (let candidate = 0; candidate < CANDIDATES; candidate++) {
    const at = frame * CANDIDATES + candidate

    if (row[at] === ref) return

    if (row[at] < 0) {
      row[at] = ref

      return
    }
  }
}

// putPieces adds a group's piece to a bone's row at each sprite frame that shows one
function putPieces(table: Int32Array[], id: number, group: number, frames: number[]) {
  frames.forEach((piece, frame) => {
    if (piece >= 0) putPiece(table, id, frame, group * PIECES + piece)
  })
}

// GroupRow is a bone's row in one group. In a format 4 group a sprite frame past the end of the row shows its last
// piece: a set draws each frame of a symbol, and the game shows a symbol's last frame for any frame past it
type GroupRow = { group: number; frames: number[]; holdsLast: boolean }

// Table is each bone's candidates per sprite frame, and, for a bone a format 4 group draws, the candidates a frame
// past the end of its row shows
type Table = { rows: Int32Array[]; tails: (Int32Array | undefined)[] }

// heldTo is a format 4 group's row stretched to a length, its last piece shown in the frames past its end
function heldTo(frames: number[], length: number): number[] {
  const last = frames.at(-1) ?? -1

  return Array.from({ length }, (_, frame) => (frame < frames.length ? frames[frame] : last))
}

// tailOf is the candidates a frame past the end of a bone's row shows: the last piece of each format 4 group's row,
// in lookup order, or undefined when there's none
function tailOf(groupRows: GroupRow[]): Int32Array | undefined {
  const tail = new Int32Array(CANDIDATES).fill(-1)

  for (const { group, frames, holdsLast } of groupRows) {
    const last = frames.at(-1) ?? -1

    if (holdsLast && last >= 0) putCandidate(tail, 0, group * PIECES + last)
  }

  return tail[0] < 0 ? undefined : tail
}

// rowsShown are the rows a bone is drawn from. A bone a format 4 group has first takes its whole row from that group,
// as the game takes a bone's art from one place: a look's sets come in the order it picks art in. Rows that start
// with a format 3 group's are all kept, as the first seconds' group shares its bones with the whole match's
function rowsShown(groupRows: GroupRow[]): GroupRow[] {
  return groupRows[0].holdsLast ? groupRows.slice(0, 1) : groupRows
}

// putRows adds a bone's rows from the groups it's drawn from, in lookup order. A format 4 group's row is stretched to
// the longest, so its last piece stays a candidate where another group's row goes on
function putRows(table: Table, id: number, groupRows: GroupRow[]) {
  const shown = rowsShown(groupRows)
  const length = Math.max(...shown.map(({ frames }) => frames.length))

  for (const { group, frames, holdsLast } of shown) {
    putPieces(table.rows, id, group, holdsLast ? heldTo(frames, length) : frames)
  }

  table.tails[id] = tailOf(shown)
}

// ArtSet is what one player (or the objects in one look) draws with: its art groups in lookup order, read into
// tables of the pieces each bone shows at each sprite frame, without a weapon skin ("") and with each weapon's
export class ArtSet {
  readonly groups: number[]
  private readonly names: Map<string, number>
  private readonly tables = new Map<string, Table>()

  // names are the bones' ids, which sets drawing the same animations share
  constructor(groups: number[], groupJson: (group: number) => AnyArtGroup, names = new Map<string, number>()) {
    this.groups = groups
    this.names = names

    const base = this.baseTable(groupJson)

    this.tables.set('', base)

    const weapons = new Set(groups.flatMap((group) => Object.keys(groupJson(group).weapons)))

    for (const weapon of weapons) this.tables.set(weapon, this.weaponTable(weapon, base, groupJson))
  }

  // groupRows is each bone's row in every group, in lookup order, from the groups' bones or a weapon's
  private groupRows(
    groupJson: (group: number) => AnyArtGroup,
    bonesOf: (json: AnyArtGroup) => Record<string, number[]>,
  ): Map<number, GroupRow[]> {
    const rows = new Map<number, GroupRow[]>()

    for (const group of this.groups) {
      const json = groupJson(group)

      for (const [name, frames] of Object.entries(bonesOf(json))) {
        const id = this.nameId(name, true)
        const row: GroupRow = { group, frames, holdsLast: json.format === SET_FORMAT }

        const bone = rows.get(id) ?? []

        bone.push(row)
        rows.set(id, bone)
      }
    }

    return rows
  }

  // baseTable is each bone's pieces without a weapon skin, from every group in lookup order
  private baseTable(groupJson: (group: number) => AnyArtGroup): Table {
    const table: Table = { rows: [], tails: [] }

    for (const [id, groupRows] of this.groupRows(groupJson, (json) => json.bones)) putRows(table, id, groupRows)

    return table
  }

  // weaponTable is the base table with the bones a weapon's skin changes replaced by that skin's pieces
  private weaponTable(weapon: string, base: Table, groupJson: (group: number) => AnyArtGroup): Table {
    const table: Table = { rows: base.rows.map((row) => row.slice()), tails: base.tails.slice() }
    const overrides = this.groupRows(groupJson, (json) => json.weapons[weapon] ?? {})

    for (const [id, groupRows] of overrides) {
      table.rows[id] = new Int32Array(Math.max(groupRows[0].frames.length, 1) * CANDIDATES).fill(-1)
      putRows(table, id, groupRows)
    }

    return table
  }

  // nameId is a bone's id in the tables, or -1 when no group draws it
  nameId(name: string, add = false): number {
    const id = this.names.get(name)

    if (id !== undefined) return id

    if (!add) return -1

    const added = this.names.size

    this.names.set(name, added)

    return added
  }

  // weapons are the tables' keys: "" for none, then each weapon whose skin changes some bone
  weapons(): string[] {
    return [...this.tables.keys()]
  }

  // pieces is a bone's row for a weapon held: two candidates per sprite frame, -1 for none
  pieces(weapon: string, id: number): Int32Array | undefined {
    return this.tableOf(weapon)?.rows[id]
  }

  // tail is the two candidates a sprite frame past the end of a bone's row shows, or undefined for none
  tail(weapon: string, id: number): Int32Array | undefined {
    return this.tableOf(weapon)?.tails[id]
  }

  private tableOf(weapon: string): Table | undefined {
    return this.tables.get(weapon) ?? this.tables.get('')
  }
}

// Animations are a player's (or the objects') animations from their packs, with each pack's names as the set's ids
export class Animations {
  readonly byIndex = new Map<number, { animation: PackedAnimation; ids: Int32Array }>()

  add(pack: Pack, set: ArtSet) {
    const ids = Int32Array.from(pack.names, (name) => set.nameId(name))

    for (const [index, animation] of pack.animations) this.byIndex.set(index, { animation, ids })
  }

  has(index: number): boolean {
    return this.byIndex.has(index)
  }

  frameCount(index: number): number {
    return this.byIndex.get(index)?.animation.frameCount ?? 0
  }

  // frame is the draws of an animation's frame, or of the nearest frame before it the pack has
  frame(index: number, frame: number): Frame | undefined {
    const entry = this.byIndex.get(index)

    if (!entry) return undefined

    for (let earlier = Math.min(frame, entry.animation.frameCount - 1); earlier >= 0; earlier--) {
      const draws = entry.animation.frames.get(earlier)

      if (draws) return { draws, ids: entry.ids }
    }

    const first = entry.animation.frames.values().next().value

    return first ? { draws: first, ids: entry.ids } : undefined
  }
}

export type Frame = { draws: Float32Array; ids: Int32Array }

export type DrawPiece = (
  ref: number,
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  opacity: number,
) => void

// loadedPieceOf is the first of a draw's candidates isLoaded allows: the piece ref, -1 when the draw shows no piece,
// or undefined when it shows one that hasn't loaded
function loadedPieceOf(
  set: ArtSet,
  weapon: string,
  frame: Frame,
  offset: number,
  isLoaded: (ref: number) => boolean,
): number | undefined {
  const id = frame.ids[frame.draws[offset]]

  if (id === undefined || id < 0) return -1

  const row = set.pieces(weapon, id)
  const at = frame.draws[offset + 1] * CANDIDATES

  if (row && at < row.length) return loadedCandidateOf(row, at, isLoaded)

  const tail = set.tail(weapon, id)

  return tail ? loadedCandidateOf(tail, 0, isLoaded) : -1
}

// loadedCandidateOf is the first of the two candidates at a row's offset isLoaded allows, -1 for none, or undefined
// when neither has loaded
function loadedCandidateOf(row: Int32Array, at: number, isLoaded: (ref: number) => boolean): number | undefined {
  if (row[at] < 0) return -1

  if (isLoaded(row[at])) return row[at]

  const second = row[at + 1]

  return second >= 0 && isLoaded(second) ? second : undefined
}

// drawAt calls draw for one draw of a frame with the matrix taking its piece's units to the space place takes the
// animation's units to
function drawAt(draws: Float32Array, offset: number, ref: number, place: Matrix, draw: DrawPiece) {
  const [pa, pb, pc, pd, pe, pf] = place
  const a = draws[offset + 3]
  const b = draws[offset + 4]
  const c = draws[offset + 5]
  const d = draws[offset + 6]
  const tx = draws[offset + 7]
  const ty = draws[offset + 8]
  const opacity = draws[offset + 2]

  draw(
    ref,
    pa * a + pc * b,
    pb * a + pd * b,
    pa * c + pc * d,
    pb * c + pd * d,
    pa * tx + pc * ty + pe,
    pb * tx + pd * ty + pf,
    opacity,
  )
}

// eachDraw calls draw for every draw of a frame that shows a piece, in order, with the first of its candidates
// isLoaded allows and the matrix taking the piece's units to the space place takes the animation's units to. It
// returns whether every piece had a loaded candidate, and draws nothing when one didn't. It allocates nothing
export function eachDraw(
  set: ArtSet,
  weapon: string,
  frame: Frame,
  place: Matrix,
  isLoaded: (ref: number) => boolean,
  draw?: DrawPiece,
): boolean {
  const draws = frame.draws

  // the first pass checks every piece is there, so nothing is drawn of a frame that can't be drawn whole
  for (let offset = 0; offset < draws.length; offset += DRAW_FIELDS) {
    if (loadedPieceOf(set, weapon, frame, offset, isLoaded) === undefined) return false
  }

  if (!draw) return true

  for (let offset = 0; offset < draws.length; offset += DRAW_FIELDS) {
    const ref = loadedPieceOf(set, weapon, frame, offset, isLoaded) ?? -1

    if (ref >= 0) drawAt(draws, offset, ref, place, draw)
  }

  return true
}

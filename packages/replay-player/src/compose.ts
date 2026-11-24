// How a pre-drawn set's weighted piece takes a look's colours: per pixel, the base's colour plus, for each colour the
// piece keeps a weight for, that weight times the colour the look swaps it to. No DOM: the 2D path in
// src/compose-sheet.ts runs it over a canvas's pixels, and it's the same arithmetic, operation for operation, as
// brawlhalla-anims' src/set-compose.ts, which `predraw draw --check` checks every set with

// a weight sheet's three channels each hold one colour's weight
export const WEIGHTS_PER_SHEET = 3

// the most weight sheets a sheet can have: with its base, what one WebGL2 shader can read. In 11.01 the busiest piece
// keeps 23 colours
export const MAX_WEIGHT_SHEETS = 8

// the most colours a piece can keep a weight for
export const MAX_WEIGHTS = MAX_WEIGHT_SHEETS * WEIGHTS_PER_SHEET

// the art type a swap of no type is, which applies to a piece of any type
const ANY_ART = 0

// Swap is a look's colour swap as a manifest has it: [from, to, art type]
export type Swap = [number, number, number]

// firstSwaps is each colour's first swap of a type, as the game keeps one swap per colour and type
function firstSwaps(artType: number, swaps: Swap[]): Map<number, number> {
  const first = new Map<number, number>()

  for (const [from, to, type] of swaps) {
    if (type === artType && !first.has(from)) first.set(from, to)
  }

  return first
}

// swapsFor is the game's lookup for a piece of an art type: a colour's first swap of that type, else its first of no
// type. A swap to 0 counts as none, since the game reads 0 as "no swap here"
function swapsFor(artType: number, swaps: Swap[]): Map<number, number> {
  const swapped = new Map<number, number>()

  for (const type of [ANY_ART, artType]) {
    for (const [from, to] of firstSwaps(type, swaps)) {
      if (to !== 0) swapped.set(from, to)
    }
  }

  return swapped
}

// resolvedColors are the colours a look gives a piece's weights, from its swappable entry ([art type, colour, ...],
// or [] for none): each colour's swap, or the colour itself
export function resolvedColors(entry: number[], swaps: Swap[]): number[] {
  const [artType, ...colors] = entry

  if (artType === undefined) return []

  const swapped = swapsFor(artType, swaps)

  return colors.map((color) => swapped.get(color) ?? color)
}

// SheetPixels is a decoded sheet: its width, and its pixels with as many channels as it has, colours plain (not
// premultiplied), as getImageData gives them
export type SheetPixels = { width: number; channels: number; pixels: Uint8Array | Uint8ClampedArray }

// PieceRect is a piece's rectangle on its sheet, in pixels
export type PieceRect = { sx: number; sy: number; sw: number; sh: number }

const channelOf = (color: number, channel: number) => (color >> (16 - channel * 8)) & 255

// premultipliedLevel is a channel of a plain-colour pixel as a canvas holds it, in a byte
const premultipliedLevel = (value: number, alpha: number) => Math.round((value * alpha) / 255)

// composePiece writes a weighted piece in its colours into out, at the piece's own rectangle: the base's colour times
// its alpha rounded to a byte, plus each weight / 255 times its colour, divided by the alpha again into a canvas's
// bytes. The base is RGBA, the weight sheets RGB or RGBA; out is RGBA with plain colours, the base's width. Colour k's
// weight is channel k % 3 of weight sheet floor(k / 3)
export function composePiece(
  base: SheetPixels,
  weights: SheetPixels[],
  rect: PieceRect,
  colors: number[],
  out: Uint8ClampedArray,
): void {
  for (let row = 0; row < rect.sh; row++) {
    for (let column = 0; column < rect.sw; column++) {
      composePixel(base, weights, (rect.sy + row) * base.width + rect.sx + column, colors, out)
    }
  }
}

function composePixel(
  base: SheetPixels,
  weights: SheetPixels[],
  pixel: number,
  colors: number[],
  out: Uint8ClampedArray,
): void {
  const at = pixel * 4
  const alpha = base.pixels[at + 3]

  if (alpha === 0) {
    out.fill(0, at, at + 4)

    return
  }

  // a canvas holds the base premultiplied in bytes, and the 2D path reads it back from one: a faint pixel's plain
  // colour doesn't survive that round trip, but the rounded premultiplied colour does
  let red = premultipliedLevel(base.pixels[at], alpha)
  let green = premultipliedLevel(base.pixels[at + 1], alpha)
  let blue = premultipliedLevel(base.pixels[at + 2], alpha)

  for (let k = 0; k < colors.length; k++) {
    const sheet = weights[Math.floor(k / WEIGHTS_PER_SHEET)]
    const weight = sheet.pixels[pixel * sheet.channels + (k % WEIGHTS_PER_SHEET)] / 255

    if (weight === 0) continue

    red += weight * channelOf(colors[k], 0)
    green += weight * channelOf(colors[k], 1)
    blue += weight * channelOf(colors[k], 2)
  }

  out[at] = (red * 255) / alpha
  out[at + 1] = (green * 255) / alpha
  out[at + 2] = (blue * 255) / alpha
  out[at + 3] = alpha
}

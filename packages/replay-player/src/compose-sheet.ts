// Composes a weighted sheet of a pre-drawn set into a look's colours, once, into a bitmap src/draw.ts draws from
// with drawImage as it does any sheet: a 2D canvas runs the sum over its pixels (src/compose.ts). Browser only
import { composePiece, type PieceRect, type SheetPixels } from './compose.ts'

// ColoredPiece is a piece of a weighted sheet with the colours its weights take in a look, in the order of its
// weights; a piece with none keeps the base's colours
export type ColoredPiece = PieceRect & { colors: number[] }

type Canvas = OffscreenCanvas | HTMLCanvasElement

// decodeWeighted decodes a weighted sheet's base or weight sheet as it was stored: plain colours, as the sum needs
// them, and no colour space conversion, so a weight stays the number it was drawn as
function decodeWeighted(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
}

// WeightedPixels are a weighted sheet's base and weight sheets as a canvas hands them back
type WeightedPixels = { base: SheetPixels; weights: SheetPixels[] }

// WeightedImages is a weighted sheet's decoded base and weight sheets, composed from in each colouring a match gives
// the sheet. The 2D path reads their pixels once and every colouring shares them: a big sheet's are tens of MB
export class WeightedImages {
  readonly base: ImageBitmap
  readonly weights: ImageBitmap[]
  private read: WeightedPixels | undefined

  constructor(base: ImageBitmap, weights: ImageBitmap[]) {
    this.base = base
    this.weights = weights
  }

  pixels(): WeightedPixels {
    this.read ??= { base: pixelsOf(this.base), weights: this.weights.map(pixelsOf) }

    return this.read
  }

  // close lets the decoded sheets and their pixels go, once every colouring is composed
  close() {
    this.base.close()

    for (const weight of this.weights) weight.close()

    this.read = undefined
  }
}

// decodeImages decodes a weighted sheet's base and weight sheets. When one fails, those that decoded are closed
export async function decodeImages(base: Blob, weights: Blob[]): Promise<WeightedImages> {
  const results = await Promise.allSettled([base, ...weights].map(decodeWeighted))
  const decoded = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')

  if (failure) {
    for (const bitmap of decoded) bitmap.close()

    throw failure.reason
  }

  const [baseBitmap, ...weightBitmaps] = decoded

  return new WeightedImages(baseBitmap, weightBitmaps)
}

// composeSheet is a weighted sheet in its pieces' colours
export function composeSheet(images: WeightedImages, pieces: ColoredPiece[]): Promise<ImageBitmap> {
  return composeOnCanvas(images, pieces)
}

function canvasOf(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)

  return Object.assign(document.createElement('canvas'), { width, height })
}

function bitmapOf(canvas: Canvas): Promise<ImageBitmap> {
  if ('transferToImageBitmap' in canvas) return Promise.resolve(canvas.transferToImageBitmap())

  return createImageBitmap(canvas)
}

// context2dOf is a canvas's 2D context. One that's read from is kept in memory rather than on the GPU, so reading it
// back doesn't wait on the GPU
function context2dOf(canvas: Canvas, isRead: boolean): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: isRead })

  if (!context) throw new Error('compose sheet: no 2D canvas')

  return context as OffscreenCanvasRenderingContext2D
}

function pixelsOf(bitmap: ImageBitmap): SheetPixels {
  const context = context2dOf(canvasOf(bitmap.width, bitmap.height), true)

  context.drawImage(bitmap, 0, 0)

  const image = context.getImageData(0, 0, bitmap.width, bitmap.height)

  return { width: image.width, channels: 4, pixels: image.data }
}

// composeOnCanvas is the 2D path: the base's pixels with each weighted piece summed in, put back on a canvas
export function composeOnCanvas(images: WeightedImages, pieces: ColoredPiece[]): Promise<ImageBitmap> {
  const { base, weights } = images.pixels()
  const width = images.base.width
  const height = images.base.height
  const out = new Uint8ClampedArray(base.pixels)

  for (const piece of pieces) {
    if (piece.colors.length > 0) composePiece(base, weights, piece, piece.colors, out)
  }

  const canvas = canvasOf(width, height)

  context2dOf(canvas, false).putImageData(new ImageData(out, width, height), 0, 0)

  return bitmapOf(canvas)
}

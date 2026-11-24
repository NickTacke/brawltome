// Composes a weighted sheet of a pre-drawn set into a look's colours, once, into a bitmap src/draw.ts draws from
// with drawImage as it does any sheet. A WebGL2 shader does it where there is one, one shared context for the page;
// without it, or once that context is lost, a 2D canvas does the same sum over its pixels (src/compose.ts). Browser
// only
import { composePiece, MAX_WEIGHT_SHEETS, MAX_WEIGHTS, type PieceRect, type SheetPixels } from './compose.ts'

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
export async function composeSheet(images: WeightedImages, pieces: ColoredPiece[]): Promise<ImageBitmap> {
  return (await composeOnGpu(images, pieces)) ?? composeOnCanvas(images, pieces)
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

// the shader draws one piece: a full-screen triangle, cut to the piece by the scissor
const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`

// the base arrives as plain colour, so it's multiplied by its alpha and rounded to a byte, as the 2D path's canvas
// holds it, before the weights are added; the sum is the premultiplied colour the canvas keeps, at most the alpha, as
// the 2D path's bytes can't say more. A sampler array takes only constant indexes, so each weight sheet has its own
// line. The framebuffer's first row is the bitmap's last, so a row is read from the other end of the sheet
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D base;
uniform highp sampler2D weights[${MAX_WEIGHT_SHEETS}];
uniform vec3 colors[${MAX_WEIGHTS}];
uniform int height;
out vec4 color;

vec3 colored(vec3 weight, int first) {
  return weight.r * colors[first] + weight.g * colors[first + 1] + weight.b * colors[first + 2];
}

void main() {
  ivec2 at = ivec2(int(gl_FragCoord.x), height - 1 - int(gl_FragCoord.y));
  vec4 plain = texelFetch(base, at, 0);
  vec3 sum = floor(plain.rgb * plain.a * 255.0 + 0.5) / 255.0;
  ${weightLines()}
  color = vec4(min(sum, vec3(plain.a)), plain.a);
}`

function weightLines(): string {
  const lines = Array.from(
    { length: MAX_WEIGHT_SHEETS },
    (_, sheet) => `sum += colored(texelFetch(weights[${sheet}], at, 0).rgb, ${sheet * 3});`,
  )

  return lines.join('\n  ')
}

// the sheets composed on the shared context: a bitmap it hands over lives in its memory and is lost with it
const madeOnGpu = new WeakSet<ImageBitmap>()

// told once the shared context is lost
const lossListeners = new Set<() => void>()

let isGpuLost = false

// the shared context, once started: it's lost a little before the page is told
let sharedGl: WebGL2RenderingContext | undefined

// isLostSheet says whether a composed sheet went with a lost context: it draws as nothing from then on
export function isLostSheet(bitmap: ImageBitmap): boolean {
  if (!madeOnGpu.has(bitmap)) return false

  return isGpuLost || sharedGl?.isContextLost() === true
}

// onGpuLost calls a listener once the shared context is lost, so the sheets composed on it can be composed again on
// the 2D path. Once the context is lost the 2D path takes over for good, so a listener is told at most once
export function onGpuLost(listener: () => void) {
  if (!isGpuLost) lossListeners.add(listener)
}

function loseGpu() {
  isGpuLost = true
  gpuState = Promise.resolve(null)

  for (const listener of lossListeners) listener()

  lossListeners.clear()
}

type Gpu = { compose: (images: WeightedImages, pieces: ColoredPiece[]) => ImageBitmap | null }

// composeOnGpu is a sheet composed on the shared WebGL2 context, or null where it can't be: no WebGL2, a lost
// context, a sheet larger than a texture, or a draw that failed
async function composeOnGpu(images: WeightedImages, pieces: ColoredPiece[]): Promise<ImageBitmap | null> {
  try {
    const composed = (await gpu())?.compose(images, pieces) ?? null

    if (composed) madeOnGpu.add(composed)

    return composed
  } catch {
    return null
  }
}

// gpuState is the page's one WebGL2 composer once asked for: null where there's none
let gpuState: Promise<Gpu | null> | undefined

function gpu(): Promise<Gpu | null> {
  gpuState ??= startGpu().catch(() => null)

  return gpuState
}

async function startGpu(): Promise<Gpu | null> {
  if (typeof OffscreenCanvas === 'undefined') return null

  const canvas = new OffscreenCanvas(1, 1)

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  })

  if (!gl) return null

  const program = programOf(gl)

  if (!program) return null

  const shader = new ShaderSheet(canvas, gl, program)

  if (!(await composesAsCanvas(shader))) return null

  canvas.addEventListener('webglcontextlost', loseGpu)
  sharedGl = gl

  return { compose: (images, pieces) => shader.compose(images, pieces) }
}

// the shader's check: a half covered pixel with two colours' weights, and a faint one with none
const CHECK_BASE = [100, 50, 20, 200, 200, 0, 0, 3]
const CHECK_WEIGHTS = [64, 32, 0, 255, 0, 0, 0, 255]
const CHECK_PIECE: ColoredPiece = { sx: 0, sy: 0, sw: 2, sh: 1, colors: [0x204060, 0x102030] }

// composesAsCanvas says whether the shader composes a small sheet as the 2D path does, to the level its own rounding
// allows. A browser that premultiplies an image it was told not to, or reads a weight from the wrong channel, fails
async function composesAsCanvas(shader: ShaderSheet): Promise<boolean> {
  const images = await checkImages()

  try {
    const drawn = shader.composedPixels(images, [CHECK_PIECE])
    const expected = new Uint8ClampedArray(CHECK_BASE)
    const toPixels = (pixels: number[]) => ({ width: 2, channels: 4, pixels: new Uint8ClampedArray(pixels) })

    composePiece(toPixels(CHECK_BASE), [toPixels(CHECK_WEIGHTS)], CHECK_PIECE, CHECK_PIECE.colors, expected)

    return drawn !== null && isWithinLevel(drawn, premultiplied(expected))
  } finally {
    images.close()
  }
}

async function checkImages(): Promise<WeightedImages> {
  const imageOf = (pixels: number[]) =>
    createImageBitmap(new ImageData(new Uint8ClampedArray(pixels), 2, 1), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })

  const [base, weights] = await Promise.all([imageOf(CHECK_BASE), imageOf(CHECK_WEIGHTS)])

  return new WeightedImages(base, [weights])
}

// premultiplied is plain RGBA pixels as a canvas holds them
function premultiplied(pixels: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length)

  for (let at = 0; at < pixels.length; at += 4) {
    const alpha = pixels[at + 3]

    for (let channel = 0; channel < 3; channel++) out[at + channel] = Math.round((pixels[at + channel] * alpha) / 255)

    out[at + 3] = alpha
  }

  return out
}

// isWithinLevel says whether two drawings are at most one level apart in every channel: the 2D path rounds to plain
// colours and back, the shader only once
function isWithinLevel(drawn: Uint8Array, expected: Uint8ClampedArray): boolean {
  return expected.every((value, at) => Math.abs(value - drawn[at]) <= 1)
}

function programOf(gl: WebGL2RenderingContext): WebGLProgram | null {
  const program = gl.createProgram()

  gl.attachShader(program, shaderOf(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
  gl.attachShader(program, shaderOf(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
  gl.linkProgram(program)

  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null
}

function shaderOf(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)

  if (!shader) throw new Error('compose sheet: no shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  return shader
}

// ShaderSheet composes sheets on the shared context, one at a time
class ShaderSheet {
  private readonly canvas: OffscreenCanvas
  private readonly gl: WebGL2RenderingContext
  private readonly colors: WebGLUniformLocation | null
  private readonly height: WebGLUniformLocation | null
  private readonly none: WebGLTexture
  private readonly largest: number

  constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.canvas = canvas
    this.gl = gl
    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, 'base'), 0)

    gl.uniform1iv(
      gl.getUniformLocation(program, 'weights'),
      Array.from({ length: MAX_WEIGHT_SHEETS }, (_, sheet) => sheet + 1),
    )

    this.colors = gl.getUniformLocation(program, 'colors')
    this.height = gl.getUniformLocation(program, 'height')
    // a weight sheet a sheet doesn't have reads as nothing, and its colours are 0
    this.none = this.texture(null)
    this.largest = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  }

  // compose is the composed sheet, or null when this context can't compose it
  compose(images: WeightedImages, pieces: ColoredPiece[]): ImageBitmap | null {
    return this.render(images, pieces) ? this.canvas.transferToImageBitmap() : null
  }

  // composedPixels is a composed sheet's pixels as the context holds them, premultiplied and in the framebuffer's row
  // order, or null when this context can't compose it
  composedPixels(images: WeightedImages, pieces: ColoredPiece[]): Uint8Array | null {
    if (!this.render(images, pieces)) return null

    const gl = this.gl
    const pixels = new Uint8Array(images.base.width * images.base.height * 4)

    gl.readPixels(0, 0, images.base.width, images.base.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    return gl.getError() === gl.NO_ERROR ? pixels : null
  }

  // render draws a sheet's pieces into the canvas, and says whether it drew them all: not when the context was lost
  // or a call failed, which leaves the sheet empty or wrong
  private render(images: WeightedImages, pieces: ColoredPiece[]): boolean {
    const gl = this.gl

    if (gl.isContextLost() || !this.fits(images.base.width, images.base.height)) return false

    const textures: WebGLTexture[] = []

    try {
      for (const image of [images.base, ...images.weights]) textures.push(this.texture(image))

      this.bind(textures)
      this.draw(images.base.width, images.base.height, pieces)

      return !gl.isContextLost() && gl.getError() === gl.NO_ERROR
    } finally {
      for (const texture of textures) gl.deleteTexture(texture)
    }
  }

  private fits(width: number, height: number): boolean {
    if (width > this.largest || height > this.largest) return false

    this.canvas.width = width
    this.canvas.height = height

    return this.gl.drawingBufferWidth === width && this.gl.drawingBufferHeight === height
  }

  private texture(image: ImageBitmap | null): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)

    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    return texture
  }

  // bind puts the base on unit 0 and its weight sheets after it, the empty texture where it has none
  private bind(textures: WebGLTexture[]) {
    const gl = this.gl

    for (let unit = 0; unit <= MAX_WEIGHT_SHEETS; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, textures[unit] ?? this.none)
    }
  }

  private draw(width: number, height: number, pieces: ColoredPiece[]) {
    const gl = this.gl
    const colors = new Float32Array(MAX_WEIGHTS * 3)

    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.SCISSOR_TEST)
    gl.uniform1i(this.height, height)

    for (const piece of pieces) {
      colors.fill(0)

      for (const [colorIndex, color] of piece.colors.entries()) colors.set(rgbOf(color), colorIndex * 3)

      gl.uniform3fv(this.colors, colors)
      gl.scissor(piece.sx, height - piece.sy - piece.sh, piece.sw, piece.sh)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }
}

function rgbOf(color: number): number[] {
  return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255]
}

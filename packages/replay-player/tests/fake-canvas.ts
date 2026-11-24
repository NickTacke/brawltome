// A stand-in for the browser's bitmaps and 2D canvas, enough for the loader's 2D compose path to run in bun. A test
// image is a blob of its width and height (u32, little-endian) and its RGBA bytes; any other blob decodes to an 8 by 8
// transparent bitmap, as stubImageBitmaps does. There's no WebGL2, so sheets are composed on the 2D path
export class FakeBitmap {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
  closed = false

  constructor(width: number, height: number, pixels = new Uint8ClampedArray(width * height * 4)) {
    this.width = width
    this.height = height
    this.pixels = pixels
  }

  close() {
    this.closed = true
  }
}

class FakeImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

// FakeContext copies pixels: drawImage at 0, 0 copies a bitmap in, as a canvas would keep its plain colours
class FakeContext {
  private readonly canvas: FakeCanvas

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas
  }

  drawImage(image: FakeBitmap) {
    this.canvas.pixels.set(image.pixels)
  }

  getImageData(_x: number, _y: number, width: number, height: number) {
    readCount++

    return new FakeImageData(new Uint8ClampedArray(this.canvas.pixels), width, height)
  }

  putImageData(image: FakeImageData) {
    this.canvas.pixels.set(image.data)
  }
}

class FakeCanvas {
  width: number
  height: number
  pixels: Uint8ClampedArray

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.pixels = new Uint8ClampedArray(width * height * 4)
  }

  getContext(kind: string) {
    return kind === '2d' ? new FakeContext(this) : null
  }

  addEventListener() {}

  transferToImageBitmap() {
    composedCount++

    return new FakeBitmap(this.width, this.height, new Uint8ClampedArray(this.pixels))
  }
}

// how many sheets the 2D path has composed, and how many it has read the pixels of, since the canvas was installed
let composedCount = 0
let readCount = 0

export const composedSheets = () => composedCount

export const readSheets = () => readCount

// imageBlob is a test image's blob
export function imageBlob(width: number, height: number, pixels: Uint8Array | number[]): Blob {
  const header = new Uint32Array([width, height])

  return new Blob([new Uint8Array(header.buffer), new Uint8Array(pixels)])
}

async function decode(blob: Blob): Promise<FakeBitmap> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const header = new DataView(bytes.buffer)

  if (bytes.length < 8) return new FakeBitmap(8, 8)

  const width = header.getUint32(0, true)
  const height = header.getUint32(4, true)

  if (bytes.length !== 8 + width * height * 4) return new FakeBitmap(8, 8)

  return new FakeBitmap(width, height, new Uint8ClampedArray(bytes.subarray(8)))
}

// installFakeCanvas puts the stand-ins where the loader looks for createImageBitmap, OffscreenCanvas and ImageData
export function installFakeCanvas() {
  composedCount = 0
  readCount = 0

  Object.assign(globalThis, {
    createImageBitmap: decode,
    OffscreenCanvas: FakeCanvas,
    ImageData: FakeImageData,
  })
}

// removeFakeCanvas takes the canvas stand-ins away again, so other tests see bun as it is
export function removeFakeCanvas() {
  Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
  Reflect.deleteProperty(globalThis, 'ImageData')
}

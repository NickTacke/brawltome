// The export's pack writer (brawlhalla-anims scripts), copied here only so the tests can make packs from synthetic
// draws; the player itself only reads them. The layout is at the top of src/pack.ts. It writes the current format,
// BHA3, or the older BHA2 that packs already in the bucket have
const MATRIX = 1024
const TRANSLATE = 16

export type PackVersion = 2 | 3

const formats = {
  2: { magic: 0x32414842, drawBytes: 18 },
  3: { magic: 0x33414842, drawBytes: 22 },
} as const

export type DrawToPack = { name: string; spriteFrame: number; opacity: number; matrix: readonly number[] }
export type AnimationToPack = { index: number; frameCount: number; frames: Map<number, DrawToPack[]> }

class PackBytes {
  readonly bytes: Uint8Array<ArrayBuffer>
  private readonly view: DataView
  private at = 0

  constructor(size: number) {
    this.bytes = new Uint8Array(size)
    this.view = new DataView(this.bytes.buffer)
  }

  u8(value: number) {
    this.bytes[this.at++] = value
  }

  u16(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`pack: ${value} doesn't fit a u16`)

    this.view.setUint16(this.at, value, true)
    this.at += 2
  }

  u32(value: number) {
    this.view.setUint32(this.at, value, true)
    this.at += 4
  }

  i32(value: number, unit: number) {
    const quantized = Math.round(value * unit)

    if (quantized < -0x80000000 || quantized > 0x7fffffff) throw new Error(`pack: ${value} doesn't fit in ${unit}ths`)

    this.view.setInt32(this.at, quantized, true)
    this.at += 4
  }

  i16(value: number, unit: number) {
    const quantized = Math.round(value * unit)

    if (quantized < -0x8000 || quantized > 0x7fff) throw new Error(`pack: ${value} doesn't fit in ${unit}ths`)

    this.view.setInt16(this.at, quantized, true)
    this.at += 2
  }

  text(encoded: Uint8Array) {
    if (encoded.length > 255) throw new Error('pack: name too long')

    this.u8(encoded.length)
    this.bytes.set(encoded, this.at)
    this.at += encoded.length
  }
}

function namesOf(animations: AnimationToPack[]): string[] {
  const names = animations.flatMap((animation) => [...animation.frames.values()].flat().map((draw) => draw.name))

  return [...new Set(names)]
}

function sizeOf(encodedNames: Uint8Array[], animations: AnimationToPack[], drawBytes: number): number {
  let size = 4 + 2 + encodedNames.reduce((total, encoded) => total + 1 + encoded.length, 0) + 2

  for (const animation of animations) {
    size += 6

    for (const draws of animation.frames.values()) size += 4 + draws.length * drawBytes
  }

  return size
}

function writeDraw(out: PackBytes, draw: DrawToPack, nameIndex: number, version: PackVersion) {
  out.u16(nameIndex)
  out.u16(draw.spriteFrame)
  out.u8(Math.round(Math.max(0, Math.min(1, draw.opacity)) * 255))
  out.u8(0)

  for (let m = 0; m < 4; m++) out.i16(draw.matrix[m] ?? 0, MATRIX)

  if (version === 2) {
    out.i16(draw.matrix[4] ?? 0, TRANSLATE)
    out.i16(draw.matrix[5] ?? 0, TRANSLATE)

    return
  }

  out.i32(draw.matrix[4] ?? 0, TRANSLATE)
  out.i32(draw.matrix[5] ?? 0, TRANSLATE)
}

// writePack writes animations into a pack; it throws on a value the format can't hold
export function writePack(animations: AnimationToPack[], version: PackVersion = 3): Uint8Array<ArrayBuffer> {
  const { magic, drawBytes } = formats[version]
  const names = namesOf(animations)
  const encodedNames = names.map((name) => new TextEncoder().encode(name))
  const out = new PackBytes(sizeOf(encodedNames, animations, drawBytes))

  out.u32(magic)
  out.u16(names.length)

  for (const encoded of encodedNames) out.text(encoded)

  out.u16(animations.length)

  for (const animation of animations) {
    out.u16(animation.index)
    out.u16(animation.frameCount)
    out.u16(animation.frames.size)

    const frames = [...animation.frames].sort(([first], [second]) => first - second)

    for (const [frame, draws] of frames) {
      out.u16(frame)
      out.u16(draws.length)

      for (const draw of draws) writeDraw(out, draw, names.indexOf(draw.name), version)
    }
  }

  return out.bytes
}

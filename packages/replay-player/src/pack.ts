// Animation packs: anims/<hash>.bin, the frames a replay line shows of each animation, in a small binary form. The
// export writes them (brawlhalla-anims); this reads them.
//
// A pack is little-endian: "BHA2"; a u16 count of names and each name as a u8 length and its UTF-8 bytes (what the
// draws draw, by name, so a pack doesn't depend on any table); a u16 count of animations, each a u16 index (into the
// line's animations), a u16 frame count (the whole animation's), a u16 count of frames given, and each frame given as
// a u16 frame number, a u16 count of draws and each draw in 18 bytes: u16 name, u16 sprite frame (0-based), u8 opacity
// (of 255), a u8 0, then i16 a, b, c, d (in 1024ths) and i16 tx, ty (in 16ths). The matrix takes the art to the
// animation's units (x' = a x + c y + tx, y' = b x + d y + ty)

// "BHA2" read as a little-endian u32
const MAGIC = 0x32414842
const MATRIX_UNITS = 1024
const TRANSLATE_UNITS = 16
const DRAW_BYTES = 18

// DRAW_FIELDS is how many numbers a draw takes in a frame's array: name, spriteFrame, opacity, a, b, c, d, tx, ty
export const DRAW_FIELDS = 9

// PackedAnimation is one animation of a pack: its frame count and, for each frame given, its draws in order
export type PackedAnimation = { frameCount: number; frames: Map<number, Float32Array> }

export type Pack = { names: string[]; animations: Map<number, PackedAnimation> }

// PackReader walks a pack's bytes from the start
class PackReader {
  private readonly buffer: ArrayBuffer
  private readonly view: DataView
  private readonly decoder = new TextDecoder()
  private at = 0

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer
    this.view = new DataView(buffer)
  }

  u32(): number {
    const value = this.view.getUint32(this.at, true)

    this.at += 4

    return value
  }

  u16(): number {
    const value = this.view.getUint16(this.at, true)

    this.at += 2

    return value
  }

  text(): string {
    const length = this.view.getUint8(this.at++)
    const value = this.decoder.decode(new Uint8Array(this.buffer, this.at, length))

    this.at += length

    return value
  }

  draws(count: number): Float32Array {
    const draws = new Float32Array(count * DRAW_FIELDS)

    for (let draw = 0; draw < count; draw++, this.at += DRAW_BYTES) this.drawInto(draws, draw * DRAW_FIELDS)

    return draws
  }

  private drawInto(draws: Float32Array, offset: number) {
    const view = this.view
    const at = this.at

    draws[offset] = view.getUint16(at, true)
    draws[offset + 1] = view.getUint16(at + 2, true)
    draws[offset + 2] = view.getUint8(at + 4) / 255

    for (let m = 0; m < 4; m++) draws[offset + 3 + m] = view.getInt16(at + 6 + m * 2, true) / MATRIX_UNITS

    draws[offset + 7] = view.getInt16(at + 14, true) / TRANSLATE_UNITS
    draws[offset + 8] = view.getInt16(at + 16, true) / TRANSLATE_UNITS
  }
}

function readAnimation(reader: PackReader): PackedAnimation {
  const frameCount = reader.u16()
  const frames = new Map<number, Float32Array>()

  for (let given = reader.u16(); given > 0; given--) {
    const frame = reader.u16()

    frames.set(frame, reader.draws(reader.u16()))
  }

  return { frameCount, frames }
}

export function readPack(buffer: ArrayBuffer): Pack {
  const reader = new PackReader(buffer)

  if (reader.u32() !== MAGIC) throw new Error('read pack: not an animation pack')

  const names: string[] = []

  for (let count = reader.u16(); count > 0; count--) names.push(reader.text())

  const animations = new Map<number, PackedAnimation>()

  for (let count = reader.u16(); count > 0; count--) {
    const index = reader.u16()

    animations.set(index, readAnimation(reader))
  }

  return { names, animations }
}

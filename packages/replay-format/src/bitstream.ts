export class BitReader {
  private pos = 0

  constructor(private readonly buf: Uint8Array) {}

  bit(): number {
    if (this.pos >= this.buf.length * 8) {
      throw new Error(`BitReader EOF at bit ${this.pos}`)
    }
    const byteIndex = this.pos >> 3
    const bitOffset = this.pos & 7
    const v = (this.buf[byteIndex] >> (7 - bitOffset)) & 1
    this.pos += 1
    return v
  }

  bits(n: number): number {
    let r = 0
    for (let i = 0; i < n; i++) {
      r = (r << 1) | this.bit()
    }
    return r >>> 0
  }

  u8(): number {
    return this.bits(8)
  }

  u16(): number {
    return this.bits(16)
  }

  u32(): number {
    return this.bits(32)
  }

  i32(): number {
    const v = this.u32()
    return v >= 0x80000000 ? v - 0x100000000 : v
  }

  i16(): number {
    const v = this.u16()
    return v >= 0x8000 ? v - 0x10000 : v
  }

  bool(): boolean {
    return this.bit() === 1
  }

  string(): string {
    const len = this.u16()
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = this.u8()
    return new TextDecoder('utf-8').decode(bytes)
  }

  byteAlign(): void {
    if (this.pos & 7) this.pos = (this.pos + 7) & ~7
  }

  get position(): number {
    return this.pos
  }

  remainingBits(): number {
    return this.buf.length * 8 - this.pos
  }
}

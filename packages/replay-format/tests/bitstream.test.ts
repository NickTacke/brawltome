import { describe, expect, test } from 'bun:test'
import { BitReader } from '../src/bitstream'

describe('BitReader', () => {
  test('reads single bits MSB-first within a byte', () => {
    const r = new BitReader(new Uint8Array([0b10110010]))
    expect(r.bit()).toBe(1)
    expect(r.bit()).toBe(0)
    expect(r.bit()).toBe(1)
    expect(r.bit()).toBe(1)
    expect(r.bit()).toBe(0)
    expect(r.bit()).toBe(0)
    expect(r.bit()).toBe(1)
    expect(r.bit()).toBe(0)
  })

  test('reads N bits across byte boundary', () => {
    const r = new BitReader(new Uint8Array([0xff, 0x00]))
    expect(r.bits(16)).toBe(0xff00)
  })

  test('reads u32 big-endian bit order', () => {
    const r = new BitReader(new Uint8Array([0x01, 0x02, 0x03, 0x04]))
    expect(r.u32()).toBe(0x01020304)
  })

  test('reads u16 and string', () => {
    // len=3, then "abc"
    const r = new BitReader(new Uint8Array([0x00, 0x03, 0x61, 0x62, 0x63]))
    expect(r.string()).toBe('abc')
  })

  test('throws on EOF', () => {
    const r = new BitReader(new Uint8Array([0x01]))
    r.bits(8)
    expect(() => r.bit()).toThrow()
  })

  test('remainingBits returns correct value', () => {
    const r = new BitReader(new Uint8Array([0x00, 0x00]))
    r.bits(5)
    expect(r.remainingBits()).toBe(11)
  })
})

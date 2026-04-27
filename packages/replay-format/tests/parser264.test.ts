import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { EnvelopeError, FormatVersionUnsupportedError, ParseBoundsError } from '../src/errors'
import { parse, peekFormatVersion } from '../src/parser'
import { applyXor } from '../src/xor-key'

const FIX = join(import.meta.dir, 'fixtures')
const read = (name: string): Uint8Array | null =>
  existsSync(join(FIX, name)) ? new Uint8Array(readFileSync(join(FIX, name))) : null

const mishima = read('mishima.replay')
const suzaku = read('suzaku.replay')

describe('parse() on sample replays (format 264)', () => {
  test.if(mishima !== null)('parses Mishima 2v2 match end-to-end', () => {
    if (!mishima) return
    const r = parse(mishima)
    expect(r.formatVersion).toBe(264)
    expect(r.playlistId).toBe(8)
    expect(r.playlistName).toContain('2v2Unranked')
    expect(r.onlineGame).toBe(true)
    expect(r.heroCount).toBe(1)
    expect(r.entities).toHaveLength(4)
    expect(r.entities.map((e) => e.id).sort()).toEqual([1, 2, 3, 4])
    expect(r.koFaces.length).toBeGreaterThan(0)
    expect(r.results.length).toBeGreaterThanOrEqual(1)
    expect(r.results[0].lengthMs).toBeGreaterThan(0)
    expect(r.levelId).toBe(223)
  })

  test.if(suzaku !== null)('parses Suzaku 2v2 match end-to-end', () => {
    if (!suzaku) return
    const r = parse(suzaku)
    expect(r.formatVersion).toBe(264)
    expect(r.entities).toHaveLength(4)
    expect(r.levelId).toBe(185)
  })

  test.if(mishima !== null)('throws on truncated input', () => {
    if (!mishima) return
    const short = mishima.slice(0, 100)
    expect(() => parse(short)).toThrow()
  })
})

describe('parse error paths', () => {
  test('throws FormatVersionUnsupportedError on unsupported version', () => {
    // Build an envelope whose first u32 is 999 (not in SUPPORTED_FORMAT_VERSIONS).
    // Bit layout: version=999 then state=2 (End) packed into the next 4 bits.
    // 999 dec = 0x000003E7, then nibble 0x2 for End, then zero padding.
    const body = new Uint8Array([0x00, 0x00, 0x03, 0xe7, 0x20, 0x00, 0x00, 0x00])
    const xored = applyXor(body)
    const raw = new Uint8Array(deflateSync(Buffer.from(xored)))
    expect(() => parse(raw)).toThrow(FormatVersionUnsupportedError)
  })

  test('throws EnvelopeError on garbage bytes', () => {
    expect(() => parse(new Uint8Array([1, 2, 3]))).toThrow(EnvelopeError)
  })

  test('peekFormatVersion returns null on garbage', () => {
    expect(peekFormatVersion(new Uint8Array([1, 2, 3]))).toBe(null)
  })

  test('throws ParseBoundsError on input-entity overflow', () => {
    // Build an envelope: formatVersion=264, state=STATE_INPUTS(1), then 17 input
    // entity iterations where each is bool=1 + bits(5)=0 + i32 ic=0 (no inner inputs).
    // The 17th iteration's leading bool should trip MAX_INPUT_ENTITIES=16.
    const bits: number[] = []
    const pushBits = (value: number, width: number) => {
      for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1)
    }
    pushBits(264, 32)
    pushBits(1, 4) // STATE_INPUTS
    for (let i = 0; i < 17; i++) {
      bits.push(1) // outer bool
      pushBits(0, 5) // entityId
      pushBits(0, 32) // input count = 0
    }
    while (bits.length % 8 !== 0) bits.push(0)
    const body = new Uint8Array(bits.length / 8)
    for (let i = 0; i < bits.length; i++) {
      if (bits[i]) body[i >> 3] |= 1 << (7 - (i & 7))
    }
    const xored = applyXor(body)
    const raw = new Uint8Array(deflateSync(Buffer.from(xored)))
    expect(() => parse(raw)).toThrow(ParseBoundsError)
    expect(() => parse(raw)).toThrow(/exceeded/)
  })
})

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { EnvelopeError, FormatVersionUnsupportedError } from '../src/errors'
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

  test.if(mishima !== null)('inputs are empty by default', () => {
    if (!mishima) return
    const r = parse(mishima)
    expect(r.inputs).toEqual([])
  })

  test.if(mishima !== null)('inputs populated when requested', () => {
    if (!mishima) return
    const r = parse(mishima, { inputs: true })
    expect(r.inputs.length).toBe(4)
    for (const entry of r.inputs) {
      expect(entry.entityId).toBeGreaterThan(0)
      expect(entry.inputs.length).toBeGreaterThan(0)
      for (const ev of entry.inputs.slice(0, 3)) {
        expect(Number.isFinite(ev.timestampMs)).toBe(true)
        expect(ev.inputFlags).toBeGreaterThanOrEqual(0)
        expect(ev.inputFlags).toBeLessThan(1 << 14)
      }
    }
    const total = r.inputs.reduce((s, e) => s + e.inputs.length, 0)
    expect(total).toBe(4481)
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
})

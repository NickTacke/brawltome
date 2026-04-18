import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeEnvelope, peekFormatVersion } from '../src/envelope'
import { EnvelopeError } from '../src/errors'

const FIX = join(import.meta.dir, 'fixtures')
const maybeReadFixture = (name: string): Uint8Array | null =>
  existsSync(join(FIX, name)) ? new Uint8Array(readFileSync(join(FIX, name))) : null

const mishima = maybeReadFixture('mishima.replay')

describe('peekFormatVersion', () => {
  test.if(mishima !== null)('returns 264 for 10.05 fixture', () => {
    if (!mishima) return
    expect(peekFormatVersion(mishima)).toBe(264)
  })

  test('returns null on non-zlib input', () => {
    expect(peekFormatVersion(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toBe(null)
  })
})

describe('decodeEnvelope', () => {
  test.if(mishima !== null)('decompresses and XORs to a buffer with version prefix', () => {
    if (!mishima) return
    const out = decodeEnvelope(mishima)
    expect(out.length).toBeGreaterThan(1000)
    const dv = new DataView(out.buffer, out.byteOffset, 4)
    expect(dv.getUint32(0)).toBe(264)
  })

  test('throws EnvelopeError on garbage', () => {
    expect(() => decodeEnvelope(new Uint8Array([1, 2, 3]))).toThrow(EnvelopeError)
  })
})

import { describe, expect, test } from 'bun:test'
import { computeDedupeHash, computeRawHash } from '../dedupe'

describe('computeDedupeHash', () => {
  test('stable for equal inputs', () => {
    const a = computeDedupeHash({ randomSeed: 1, version: 264, duration: 100, fanfareId: 2 })
    const b = computeDedupeHash({ randomSeed: 1, version: 264, duration: 100, fanfareId: 2 })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  test('differs when any input changes', () => {
    const base = { randomSeed: 1, version: 264, duration: 100, fanfareId: 2 }
    const h0 = computeDedupeHash(base)
    expect(computeDedupeHash({ ...base, randomSeed: 2 })).not.toBe(h0)
    expect(computeDedupeHash({ ...base, version: 265 })).not.toBe(h0)
    expect(computeDedupeHash({ ...base, duration: 101 })).not.toBe(h0)
    expect(computeDedupeHash({ ...base, fanfareId: 3 })).not.toBe(h0)
  })
})

describe('computeRawHash', () => {
  test('sha256 of empty buffer matches known value', () => {
    expect(computeRawHash(new Uint8Array([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { readMatchInsights } from '../index'
import { countSetBits } from '../src/inputs'
import { readFixtureLine } from './fixtures'

// bh-native names 14 input bits, from up (1) to taunt7 (8192). a line with an input outside them isn't one this
// module knows how to read, so it is rejected; the bit count itself stays safe for any 32 bits

type EditableLine = { timeline: { state: Record<string, { input: [number, number][] }> } }

function lineWithInput(bits: number): EditableLine {
  const line = readFixtureLine('duel-a') as EditableLine
  const input = line.timeline.state['1']?.input ?? []

  input[1] = [input[1]?.[0] ?? 1, bits]

  return line
}

describe('input bits', () => {
  test('are counted for any 32 bit value, the top bit and all bits included', () => {
    expect(countSetBits(2_147_483_648)).toBe(1)
    expect(countSetBits(-1)).toBe(32)
    expect(countSetBits(16_383)).toBe(14)
  })

  test('outside the 14 buttons reject the line', () => {
    expect(() => readMatchInsights(lineWithInput(2_147_483_648), null)).toThrow(/format 1 timeline/)
    expect(() => readMatchInsights(lineWithInput(-1), null)).toThrow(/format 1 timeline/)
    expect(() => readMatchInsights(lineWithInput(16_384), null)).toThrow(/format 1 timeline/)
  })

  test('with every button down still read', () => {
    expect(readMatchInsights(lineWithInput(16_383), null)).not.toBeNull()
  })
})

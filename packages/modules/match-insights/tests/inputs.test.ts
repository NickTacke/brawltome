import { describe, expect, test } from 'bun:test'
import { readMatchInsights } from '../index'
import { countSetBits } from '../src/inputs'
import { readFixtureLine } from './fixtures'

// a press counts only for a button the line's own inputBits map names, so a bh-native build that records one more
// button still reads, and the extra bit is left out until the map names it. any 32 bit input is read, negative ones
// included, as the game's input is a set of bits

type EditableLine = {
  stats: { GameDuration: number }
  timeline: { inputBits?: Record<string, number>; state: Record<string, { input: [number, number][] }> }
}

// up (1) and the bit above taunt7 (16384), each pressed once, then everything at once
const presses: [number, number][] = [
  [0, 0],
  [500, 1],
  [510, 0],
  [600, 16_384],
  [610, 0],
]

function lineWithInput(input: [number, number][]): EditableLine {
  const line = readFixtureLine('duel-a') as EditableLine
  const state = line.timeline.state['1']

  if (state) state.input = input

  return line
}

function pressesRead(line: EditableLine): number | undefined {
  const extras = readMatchInsights(line, null)?.extras.players.find((player) => player.slot === 1)
  const minutes = line.stats.GameDuration / 60_000

  return extras === undefined ? undefined : Math.round(extras.inputsPerMinute * minutes)
}

describe('input bits', () => {
  test('are counted for any 32 bit value, the top bit and all bits included', () => {
    expect(countSetBits(2_147_483_648)).toBe(1)
    expect(countSetBits(-1)).toBe(32)
    expect(countSetBits(16_383)).toBe(14)
  })

  test('outside the buttons the line names still read, and only its buttons count', () => {
    expect(pressesRead(lineWithInput(presses))).toBe(1)

    expect(
      pressesRead(
        lineWithInput([
          [0, 0],
          [500, 2_147_483_648],
          [510, 0],
        ]),
      ),
    ).toBe(0)

    expect(
      pressesRead(
        lineWithInput([
          [0, 0],
          [500, -1],
          [510, 0],
        ]),
      ),
    ).toBe(14)
  })

  test('a button the map adds counts', () => {
    const line = lineWithInput(presses)

    line.timeline.inputBits = { ...line.timeline.inputBits, taunt9: 16_384 }

    expect(pressesRead(line)).toBe(2)
  })

  test('without a map every bit counts', () => {
    const line = lineWithInput([
      [0, 0],
      [500, -1],
      [510, 0],
    ])

    delete line.timeline.inputBits

    expect(pressesRead(line)).toBe(32)
  })
})

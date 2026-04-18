import { describe, expect, test } from 'bun:test'
import type { EntityInputs } from '@brawltome/replay-format'
import { InputCursor, InputDriver } from '../src/input-driver'

describe('InputCursor', () => {
  test('returns 0 before the first event', () => {
    const c = new InputCursor([
      { timestampMs: 100, inputFlags: 0b0001 },
      { timestampMs: 200, inputFlags: 0b0011 },
    ])
    expect(c.advanceTo(50)).toBe(0)
  })

  test('returns the latest event at or before the given time', () => {
    const c = new InputCursor([
      { timestampMs: 100, inputFlags: 0b0001 },
      { timestampMs: 200, inputFlags: 0b0011 },
      { timestampMs: 300, inputFlags: 0b0000 },
    ])
    expect(c.advanceTo(100)).toBe(0b0001)
    expect(c.advanceTo(199)).toBe(0b0001)
    expect(c.advanceTo(200)).toBe(0b0011)
    expect(c.advanceTo(350)).toBe(0b0000)
  })

  test('cursor is monotonic; advances do not re-read earlier events', () => {
    const c = new InputCursor([
      { timestampMs: 100, inputFlags: 0b0001 },
      { timestampMs: 200, inputFlags: 0b0011 },
    ])
    c.advanceTo(300)
    expect(c.advanceTo(50)).toBe(0b0011) // cursor is past; returns last-seen
  })
})

describe('InputDriver', () => {
  test('routes events by entity id', () => {
    const inputs: EntityInputs[] = [
      {
        entityId: 1,
        inputs: [
          { timestampMs: 100, inputFlags: 0b0001 },
          { timestampMs: 300, inputFlags: 0b0000 },
        ],
      },
      {
        entityId: 2,
        inputs: [{ timestampMs: 200, inputFlags: 0b0010 }],
      },
    ]
    const d = new InputDriver(inputs)
    expect(d.flagsAt(1, 150)).toBe(0b0001)
    expect(d.flagsAt(2, 150)).toBe(0)
    expect(d.flagsAt(2, 250)).toBe(0b0010)
    expect(d.flagsAt(1, 350)).toBe(0b0000)
  })

  test('returns 0 for unknown entity id', () => {
    const d = new InputDriver([])
    expect(d.flagsAt(99, 100)).toBe(0)
  })
})

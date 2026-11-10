import { describe, expect, test } from 'bun:test'
import { changeColour } from '../src/components/queue/queue-format'

describe('changeColour', () => {
  test('colours gains and drops the way the player page does', () => {
    expect(changeColour(24)).toBe('text-emerald-400')
    expect(changeColour(-18)).toBe('text-red-400')
  })

  test('leaves an unchanged rating quiet', () => {
    expect(changeColour(0)).toBe('text-soft')
  })
})

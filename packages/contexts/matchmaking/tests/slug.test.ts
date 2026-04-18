import { describe, expect, test } from 'bun:test'
import { generateSlug } from '../slug'

describe('generateSlug', () => {
  test('produces 9 base62 chars', () => {
    const s = generateSlug()
    expect(s).toHaveLength(9)
    expect(s).toMatch(/^[0-9A-Za-z]{9}$/)
  })

  test('each call returns a unique value', () => {
    const s = new Set<string>()
    for (let i = 0; i < 1000; i++) s.add(generateSlug())
    expect(s.size).toBe(1000)
  })
})

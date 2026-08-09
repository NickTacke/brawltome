import { describe, expect, test } from 'bun:test'
import { parsePlayerReferenceOutput, playerReferenceSchema } from '../src/player-reference'

describe('Player Reference contract', () => {
  test('accepts bounded identifiers, preserves zero-free identity, and supports absence', () => {
    expect(parsePlayerReferenceOutput({ brawlhallaId: 1, name: 'Ada' })).toEqual({ brawlhallaId: 1, name: 'Ada' })
    expect(parsePlayerReferenceOutput({ brawlhallaId: 2_147_483_647, name: 'A'.repeat(256) })).toEqual({
      brawlhallaId: 2_147_483_647,
      name: 'A'.repeat(256),
    })
    expect(parsePlayerReferenceOutput({ brawlhallaId: 1, name: '🦊'.repeat(256) })).toEqual({
      brawlhallaId: 1,
      name: '🦊'.repeat(256),
    })
    expect(parsePlayerReferenceOutput(null)).toBeNull()
  })

  test.each([
    { brawlhallaId: 0, name: 'Ada' },
    { brawlhallaId: -1, name: 'Ada' },
    { brawlhallaId: 1.5, name: 'Ada' },
    { brawlhallaId: 2_147_483_648, name: 'Ada' },
    { brawlhallaId: 1, name: '' },
    { brawlhallaId: 1, name: '   ' },
    { brawlhallaId: 1, name: 'A'.repeat(257) },
    { brawlhallaId: 1, name: '🦊'.repeat(257) },
    { brawlhallaId: 1, name: '\u200B\u200D' },
    { brawlhallaId: 1, name: 'Ada', rating: 0 },
  ])('rejects invalid or persistence-shaped output %#', (value) => {
    expect(() => playerReferenceSchema.parse(value)).toThrow()
  })
})

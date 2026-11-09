import { describe, expect, test } from 'bun:test'
import { enterTarget, movedIndex, searchTerm } from '../src/components/search/search-keys'

describe('searchTerm', () => {
  test.each(['', ' ', 'a', ' a '])('%p is too short to search', (query) => {
    expect(searchTerm(query)).toBeNull()
  })

  test('two characters are enough, without the spaces around them', () => {
    expect(searchTerm('  bo ')).toBe('bo')
  })
})

describe('enterTarget', () => {
  const guild = { kind: 'guild', id: 9 } as const

  test('opens the highlighted result', () => {
    expect(enterTarget('12345', guild)).toEqual(guild)
  })

  test('a numeric id opens that player when nothing is highlighted', () => {
    expect(enterTarget(' 12345678 ', undefined)).toEqual({ kind: 'player', id: 12345678 })
  })

  test.each(['boomie', '12ab', '0', '2147483648', '-5'])('%p opens nothing', (query) => {
    expect(enterTarget(query, undefined)).toBeNull()
  })
})

describe('movedIndex', () => {
  test('down from nothing highlighted goes to the first result', () => {
    expect(movedIndex(-1, 1, 3)).toBe(0)
  })

  test('up from nothing highlighted goes to the last result', () => {
    expect(movedIndex(-1, -1, 3)).toBe(2)
  })

  test('wraps past either end', () => {
    expect(movedIndex(2, 1, 3)).toBe(0)
    expect(movedIndex(0, -1, 3)).toBe(2)
  })

  test('no results leaves nothing highlighted', () => {
    expect(movedIndex(-1, 1, 0)).toBe(-1)
  })
})

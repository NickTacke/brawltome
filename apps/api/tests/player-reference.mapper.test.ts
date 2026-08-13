import { describe, expect, test } from 'bun:test'
import { mapPlayerReference } from '../src/mappers/player-reference.mapper'

describe('mapPlayerReference', () => {
  test('maps only canonical fields and preserves absence', () => {
    expect(mapPlayerReference({ brawlhallaId: 42, name: 'Ada' })).toEqual({ brawlhallaId: 42, name: 'Ada' })
    expect(mapPlayerReference(null)).toBeNull()
  })
})

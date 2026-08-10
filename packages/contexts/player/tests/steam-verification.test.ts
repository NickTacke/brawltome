import { describe, expect, test } from 'bun:test'
import { createSteamPlayerEvidenceResolver } from '../verification'

const checkedAt = new Date('2026-08-10T10:01:00.000Z')

describe('Steam Primary Player evidence', () => {
  test('maps only canonical Brawlhalla identity evidence', async () => {
    const resolver = createSteamPlayerEvidenceResolver(
      {
        searchBySteamId: async () => ({ brawlhalla_id: 42, name: 'Ada', unrelated: 'private-source-field' }),
      },
      () => checkedAt,
    )

    await expect(resolver.resolve('76561198000000000')).resolves.toEqual({
      brawlhallaId: 42,
      name: 'Ada',
      checkedAt,
      source: 'brawlhalla-v0-steam-search',
    })
  })

  test('distinguishes no mapping from malformed source evidence', async () => {
    const absent = createSteamPlayerEvidenceResolver({ searchBySteamId: async () => null }, () => checkedAt)
    const malformed = createSteamPlayerEvidenceResolver(
      { searchBySteamId: async () => ({ brawlhalla_id: 0, name: '' }) },
      () => checkedAt,
    )

    await expect(absent.resolve('76561198000000000')).resolves.toBeNull()
    await expect(malformed.resolve('76561198000000000')).rejects.toThrow('Malformed Steam player evidence')
  })
})

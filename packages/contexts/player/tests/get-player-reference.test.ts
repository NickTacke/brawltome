import { describe, expect, test } from 'bun:test'
import { getPlayerReference } from '../queries/get-player-reference'

describe('getPlayerReference', () => {
  test('returns only the canonical stored identity', async () => {
    const result = await getPlayerReference(
      async () => ({
        brawlhallaId: 42,
        name: 'Ada',
        aliases: ['Former Ada', 'Former Ada', 'Ada', 'ADA', '\u200b'],
        rating: 0,
        legacyRating: 1800,
      }),
      42,
    )

    expect(result).toEqual({ brawlhallaId: 42, name: 'Ada', aliases: ['Former Ada'], legacyRating: 1800 })
    await expect(
      getPlayerReference(async () => ({ brawlhallaId: 42, name: 'Müller', aliases: ['MÃ¼ller'] }), 42),
    ).resolves.toEqual({ brawlhallaId: 42, name: 'Müller', aliases: [] })
  })

  test('returns null for missing, synthetic, and invisible identities', async () => {
    expect(await getPlayerReference(async () => null, 42)).toBeNull()
    expect(await getPlayerReference(async () => ({ brawlhallaId: 42, name: 'Player 42', rating: 0 }), 42)).toBeNull()
    expect(await getPlayerReference(async () => ({ brawlhallaId: 42, name: '\u200b', rating: 0 }), 42)).toBeNull()
    expect(
      await getPlayerReference(async () => ({ brawlhallaId: 42, name: 'a'.repeat(257), rating: 0 }), 42),
    ).toBeNull()
  })
})

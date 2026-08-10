import { describe, expect, test } from 'bun:test'
import { loadPlayerWithReference } from '../../src/lib/player-reference'

describe('loadPlayerWithReference', () => {
  test('reads the canonical reference and applies its name to the V2 profile', async () => {
    const result = await loadPlayerWithReference(
      {
        player: {
          referenceById: { query: async () => ({ brawlhallaId: 42, name: 'Canonical' }) },
          rankedById: { query: async () => ({ brawlhallaId: 42, lastSuccessAt: '2026-08-09T22:00:00Z' }) },
          careerById: { query: async () => null },
          byId: { query: async () => ({ name: 'Legacy', rating: 9999, games: 999 }) },
        },
      },
      42,
    )

    expect(result).toEqual({
      reference: { brawlhallaId: 42, name: 'Canonical' },
      player: {
        name: 'Canonical',
        rating: 9999,
        games: 999,
        currentSeason: { brawlhallaId: 42, lastSuccessAt: '2026-08-09T22:00:00Z' },
        career: null,
      },
    })
  })

  test('makes canonical absence authoritative and propagates transport failures', async () => {
    expect(
      await loadPlayerWithReference(
        {
          player: {
            referenceById: { query: async () => null },
            rankedById: { query: async () => null },
            careerById: { query: async () => null },
            byId: { query: async () => ({ name: 'Player 42', rating: 0 }) },
          },
        },
        42,
      ),
    ).toEqual({ reference: null, player: null })

    await expect(
      loadPlayerWithReference(
        {
          player: {
            referenceById: { query: async () => Promise.reject(new Error('transport failed')) },
            rankedById: { query: async () => null },
            careerById: { query: async () => null },
            byId: { query: async () => null },
          },
        },
        42,
      ),
    ).rejects.toThrow('transport failed')
  })
})

import { describe, expect, test } from 'bun:test'
import { loadPlayerWithReference } from '@/lib/player-reference'

describe('loadPlayerWithReference', () => {
  test('reads the canonical reference and applies its name to the V2 profile', async () => {
    const result = await loadPlayerWithReference(
      {
        player: {
          referenceById: { query: async () => ({ brawlhallaId: 42, name: 'Canonical' }) },
          byId: { query: async () => ({ name: 'Legacy', rating: 0 }) },
        },
      },
      42,
    )

    expect(result).toEqual({
      reference: { brawlhallaId: 42, name: 'Canonical' },
      player: { name: 'Canonical', rating: 0 },
    })
  })

  test('makes canonical absence authoritative and propagates transport failures', async () => {
    expect(
      await loadPlayerWithReference(
        {
          player: {
            referenceById: { query: async () => null },
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
            byId: { query: async () => null },
          },
        },
        42,
      ),
    ).rejects.toThrow('transport failed')
  })
})

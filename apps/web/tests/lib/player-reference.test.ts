import { describe, expect, test } from 'bun:test'
import { loadPlayerWithReference } from '../../src/lib/player-reference'

function client(reference: { brawlhallaId: number; name: string; aliases: string[] } | null) {
  return {
    player: {
      referenceById: { query: async () => reference },
      rankedById: { query: async () => ({ brawlhallaId: 42, snapshot: null }) },
      careerById: { query: async () => ({ brawlhallaId: 42, snapshot: null }) },
      leaderboardStandingById: {
        query: async () => ({
          region: 'AUS',
          rating: 1973,
          peakRating: 2039,
          tier: 'Diamond',
          wins: 39,
          games: 69,
          observedAt: '2026-10-07T13:30:15.000Z',
        }),
      },
    },
    clan: {
      membershipByPlayerId: { query: async () => ({ clanId: 7, clanName: 'Current Clan' }) },
    },
  }
}

describe('loadPlayerWithReference', () => {
  test('assembles the profile only from canonical Player and Clans reads', async () => {
    const result = await loadPlayerWithReference(
      client({ brawlhallaId: 42, name: 'Canonical', aliases: ['Former Name'] }),
      42,
    )

    expect(result).toEqual({
      reference: { brawlhallaId: 42, name: 'Canonical', aliases: ['Former Name'] },
      player: {
        brawlhallaId: 42,
        name: 'Canonical',
        aliases: ['Former Name'],
        clan: { clanId: 7, clanName: 'Current Clan' },
        bestLegendNameKey: null,
        currentSeason: { brawlhallaId: 42, snapshot: null },
        career: { brawlhallaId: 42, snapshot: null },
        leaderboardStanding: expect.objectContaining({ rating: 1973, region: 'AUS' }),
      },
    })
  })

  test('preserves canonical reference metadata', async () => {
    const reference = {
      brawlhallaId: 42,
      name: 'Canonical',
      aliases: [],
      bestLegendNameKey: 'bodvar',
      legacyRating: 1_800,
    }
    const result = await loadPlayerWithReference(client(reference), 42)

    expect(result.player).toMatchObject({ bestLegendNameKey: 'bodvar', legacyRating: 1_800 })
  })

  test('makes canonical absence authoritative', async () => {
    await expect(loadPlayerWithReference(client(null), 42)).resolves.toEqual({ reference: null, player: null })
  })

  test('propagates canonical transport failures', async () => {
    const failing = client(null)
    failing.player.referenceById.query = async () => Promise.reject(new Error('transport failed'))

    await expect(loadPlayerWithReference(failing, 42)).rejects.toThrow('transport failed')
  })

  test('renders without a leaderboard standing when that lookup fails', async () => {
    const result = await loadPlayerWithReference(
      {
        player: {
          referenceById: { query: async () => ({ brawlhallaId: 42, name: 'Player', aliases: [] }) },
          rankedById: { query: async () => null },
          careerById: { query: async () => null },
          leaderboardStandingById: {
            query: async () => {
              throw new Error('api unavailable')
            },
          },
        },
        clan: { membershipByPlayerId: { query: async () => null } },
      },
      42,
    )
    expect(result.player?.leaderboardStanding).toBeNull()
  })
})

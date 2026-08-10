import { describe, expect, test } from 'bun:test'
import { discoverySearchOutputSchema } from '../src/discovery'

describe('Discovery contract', () => {
  test('preserves type-distinct overlapping IDs and rejects private or persistence fields', () => {
    const output = {
      players: [
        {
          brawlhallaId: 42,
          name: 'Public Player',
          region: null,
          rating: null,
          viewCount: 0,
          bestLegendNameKey: null,
          matchedAlias: 'Former Name',
        },
      ],
      clans: [{ clanId: 42, clanName: 'Preserved Clan', clanXp: '123', memberCount: 4 }],
    }
    expect(discoverySearchOutputSchema.parse(output)).toEqual(output)
    expect(() =>
      discoverySearchOutputSchema.parse({
        ...output,
        players: [{ ...output.players[0], savedByAccountIds: ['private-account'] }],
      }),
    ).toThrow()
  })
})

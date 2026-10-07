import { describe, expect, test } from 'bun:test'
import { leaderboardDeepCrawlStandings } from '../composition'

describe('deep crawl standings', () => {
  test('maps 1v1 player rows with resolved tiers and skips team rows', () => {
    expect(
      leaderboardDeepCrawlStandings({
        totalPages: 2,
        rankings: [
          {
            identity: { type: 'one-vs-one-player', player: { id: 5806297, username: 'Boozer' } },
            rating: 1973,
            best_rating: 2039,
            rank: 3987,
            wins: 39,
            losses: 30,
            region: 'AUS',
            tier: 'Diamond',
          },
          {
            identity: { type: 'one-vs-one-player', player: { id: 7, username: 'No Tier' } },
            rating: 2050,
            best_rating: 2100,
            rank: 3988,
            wins: 1,
            losses: 0,
            region: 'EU',
            tier: null,
          },
          {
            identity: {
              type: 'fixed-two-vs-two-team',
              players: [
                { id: 1, username: 'One' },
                { id: 2, username: 'Two' },
              ],
            },
            rating: 1500,
            best_rating: 1500,
            rank: 3989,
            wins: 1,
            losses: 1,
            region: 'EU',
            tier: 'Gold 1',
          },
        ],
      }),
    ).toEqual([
      {
        brawlhallaId: 5806297,
        name: 'Boozer',
        region: 'AUS',
        rating: 1973,
        peakRating: 2039,
        tier: 'Diamond',
        wins: 39,
        games: 69,
      },
      {
        brawlhallaId: 7,
        name: 'No Tier',
        region: 'EU',
        rating: 2050,
        peakRating: 2100,
        tier: 'Diamond',
        wins: 1,
        games: 1,
      },
    ])
  })
})

import { describe, expect, test } from 'bun:test'
import { leaderboardDeepCrawlStandings, leaderboardDeepCrawlTeams } from '../composition'

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

  test('maps solo 2v2 rows like 1v1 and 2v2 rows to teams without names', () => {
    const page = {
      totalPages: 1,
      rankings: [
        {
          identity: { type: 'solo-two-vs-two-player' as const, player: { id: 9, username: 'Solo' } },
          rating: 1600,
          best_rating: 1650,
          rank: 1,
          wins: 4,
          losses: 1,
          region: 'EU' as const,
          tier: 'Gold 5',
        },
        {
          identity: {
            type: 'fixed-two-vs-two-team' as const,
            players: [
              { id: 21, username: 'Old Name' },
              { id: 20, username: 'Other Old Name' },
            ] as const,
          },
          rating: 1800,
          best_rating: 1820,
          rank: 2,
          wins: 10,
          losses: 5,
          region: 'EU' as const,
          tier: 'Platinum 4',
        },
      ],
    }
    expect(leaderboardDeepCrawlStandings(page)).toEqual([
      {
        brawlhallaId: 9,
        name: 'Solo',
        region: 'EU',
        rating: 1600,
        peakRating: 1650,
        tier: 'Gold 5',
        wins: 4,
        games: 5,
      },
    ])
    expect(leaderboardDeepCrawlTeams(page)).toEqual([
      {
        brawlhallaIdOne: 21,
        brawlhallaIdTwo: 20,
        region: 'EU',
        rating: 1800,
        peakRating: 1820,
        tier: 'Platinum 4',
        wins: 10,
        games: 15,
      },
    ])
  })
})

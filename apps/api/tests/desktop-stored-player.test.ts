import { describe, expect, test } from 'bun:test'
import { fixedTeamOf, readStoredPlayer } from '../src/desktop/stored-player'
import { fakeLobbyReads, rankedProfile, snapshotFixedTeam } from './fixtures/desktop-stored-data'

const refreshedAt = new Date('2026-11-16T10:00:00.000Z')
const observedAt = new Date('2026-11-15T22:00:00.000Z')
const standing = { rating: 2112, peakRating: 2240, tier: 'Diamond', wins: 734, games: 1204 }
const teamStanding = { rating: 1975, peakRating: 2010, tier: 'Platinum 5', wins: 88, games: 150 }

describe('reading a stored desktop player', () => {
  test('uses the profile when it has a snapshot', async () => {
    const { reads, calls } = fakeLobbyReads({
      profiles: [
        rankedProfile({
          brawlhallaId: 91913839,
          lastSuccessAt: refreshedAt,
          freshness: 'fresh',
          oneVsOne: standing,
          region: '',
          fixedTeams: [snapshotFixedTeam(40218877, 91913839, teamStanding)],
        }),
      ],
      names: { 91913839: 'Sandstorm' },
    })

    const player = await readStoredPlayer(reads, 91913839)

    expect(player).toEqual({
      brawlhallaId: 91913839,
      name: 'Sandstorm',
      source: 'profile',
      isStale: false,
      lastSuccessAt: refreshedAt,
      refreshedAt,
      oneVsOne: standing,
      region: null,
      fixedTeams: [{ ...teamStanding, brawlhallaIdOne: 40218877, brawlhallaIdTwo: 91913839 }],
    })

    expect(calls.standingById).toEqual([])

    expect(fixedTeamOf(player, 40218877)).toEqual({
      ...teamStanding,
      brawlhallaIdOne: 40218877,
      brawlhallaIdTwo: 91913839,
    })

    expect(fixedTeamOf(player, 12345)).toBeNull()
  })

  test('marks a profile stale when its last refresh is over an hour old', async () => {
    const { reads } = fakeLobbyReads({
      profiles: [
        rankedProfile({
          brawlhallaId: 91913839,
          lastSuccessAt: refreshedAt,
          freshness: 'stale',
          oneVsOne: standing,
          region: 'EU',
        }),
      ],
    })

    const player = await readStoredPlayer(reads, 91913839)

    expect(player.isStale).toBe(true)
    expect(player.region).toBe('EU')
    expect(player.name).toBeNull()
  })

  test('falls back to the leaderboard rows for a player without a snapshot', async () => {
    const { reads, calls } = fakeLobbyReads({
      names: { 40218877: 'Tidewater' },
      standings: [{ brawlhallaId: 40218877, region: 'US-E', ...standing, tier: null, observedAt }],
    })

    const player = await readStoredPlayer(reads, 40218877)

    expect(player).toEqual({
      brawlhallaId: 40218877,
      name: 'Tidewater',
      source: 'leaderboard',
      isStale: true,
      lastSuccessAt: null,
      refreshedAt: observedAt,
      oneVsOne: { ...standing, tier: null },
      region: 'US-E',
      fixedTeams: [],
    })

    expect(calls.standingById).toEqual([40218877])
  })

  test('reports none when nothing is stored, with a null name', async () => {
    const { reads } = fakeLobbyReads({})

    const player = await readStoredPlayer(reads, 60417325)

    expect(player).toEqual({
      brawlhallaId: 60417325,
      name: null,
      source: 'none',
      isStale: true,
      lastSuccessAt: null,
      refreshedAt: null,
      oneVsOne: null,
      region: null,
      fixedTeams: [],
    })
  })

  test('fails instead of answering no data when a read fails', async () => {
    const { reads } = fakeLobbyReads({})
    const failure = new Error('ranked players unavailable')

    const failingReads = { ...reads, rankedPlayers: { byId: () => Promise.reject(failure) } }

    await expect(readStoredPlayer(failingReads, 60417325)).rejects.toThrow('ranked players unavailable')
  })

  test('fails when the leaderboard read fails', async () => {
    const { reads } = fakeLobbyReads({})

    const failingReads = {
      ...reads,
      leaderboardStandings: { standingById: () => Promise.reject(new Error('leaderboard unavailable')) },
    }

    await expect(readStoredPlayer(failingReads, 60417325)).rejects.toThrow('leaderboard unavailable')
  })
})

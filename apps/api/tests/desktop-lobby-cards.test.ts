import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { DesktopLobbyContract, DesktopLobbyInputContract, DesktopStandingContract } from '@brawltome/contracts'
import { buildLobbyCards } from '../src/desktop/lobby-cards'
import { type LobbyReads, readStoredLobby } from '../src/desktop/read-lobby'
import { fakeLobbyReads, rankedProfile, snapshotFixedTeam } from './fixtures/desktop-stored-data'

function contractFixture(name: '1v1' | '2v2' | 'no-data'): DesktopLobbyContract {
  const url = new URL(`../../../packages/contracts/tests/fixtures/desktop-v1-lobby-${name}.json`, import.meta.url)

  return JSON.parse(readFileSync(url, 'utf8'))
}

async function lobbyCards(reads: LobbyReads, input: DesktopLobbyInputContract): Promise<DesktopLobbyContract> {
  const stored = await readStoredLobby(reads, input)

  return buildLobbyCards(input, stored)
}

const sandstorm = {
  brawlhallaId: 91913839,
  lastSuccessAt: new Date('2026-11-16T10:00:00.000Z'),
  oneVsOne: { rating: 2112, peakRating: 2240, tier: 'Diamond', wins: 734, games: 1204 },
  region: 'EU',
}

const tidewater = {
  brawlhallaId: 40218877,
  lastSuccessAt: new Date('2026-11-16T09:30:00.000Z'),
  oneVsOne: { rating: 1840, peakRating: 1902, tier: 'Platinum 3', wins: 412, games: 801 },
  region: 'US-E',
}

const names = { 91913839: 'Sandstorm', 40218877: 'Tidewater' }
const pairStanding = { rating: 1975, peakRating: 2010, tier: 'Platinum 5', wins: 88, games: 150 }
const olderPairStanding = { rating: 1900, peakRating: 2010, tier: 'Platinum 4', wins: 80, games: 140 }
const observedAt = new Date('2026-11-15T22:00:00.000Z')

function leaderboardRow(player: typeof sandstorm) {
  return { brawlhallaId: player.brawlhallaId, region: player.region, ...player.oneVsOne, observedAt }
}

function observedPair(standing: DesktopStandingContract) {
  return { brawlhallaIdOne: 40218877, brawlhallaIdTwo: 91913839, region: 'EU', ...standing, observedAt }
}

const pairLobby: DesktopLobbyInputContract = {
  matchType: '2v2',
  players: [
    { brawlhallaId: 91913839, team: 2 },
    { brawlhallaId: 40218877, team: 2 },
  ],
}

describe('desktop lobby cards from stored data', () => {
  test('a 1v1 card carries name, tier, Elo, peak, rank, wins and games', async () => {
    const { reads, calls } = fakeLobbyReads({
      profiles: [rankedProfile(sandstorm)],
      names,
      regionRanks: { 91913839: 48 },
    })

    const cards = await lobbyCards(reads, { matchType: '1v1', players: [{ brawlhallaId: 91913839, team: 2 }] })

    expect(cards).toEqual(contractFixture('1v1'))
    expect(calls.readBoardRanks).toEqual([{ brawlhallaId: 91913839, region: 'EU' }])
  })

  test('a player with a profile but no ranked games this season is known, with zeros', async () => {
    const zeros = { rating: 0, peakRating: 782, tier: 'Tin 0', wins: 0, games: 0 }
    const { reads } = fakeLobbyReads({ profiles: [rankedProfile({ ...sandstorm, oneVsOne: zeros })], names })

    const cards = await lobbyCards(reads, { matchType: '1v1', players: [{ brawlhallaId: 91913839, team: 2 }] })
    const [player] = cards.cards[0].players

    expect(player.known).toBe(true)
    expect(player.oneVsOne).toEqual(zeros)
  })

  test('a player we hold nothing on gets a no-data card', async () => {
    const { reads } = fakeLobbyReads({})

    const cards = await lobbyCards(reads, { matchType: '1v1', players: [{ brawlhallaId: 60417325, team: 2 }] })

    // the fixture shows the answer after the route queued a refresh, which buildLobbyCards never does itself
    const fixture = contractFixture('no-data')
    const [card] = fixture.cards

    const expected = {
      cards: [{ ...card, players: card.players.map((player) => ({ ...player, isRefreshing: false })) }],
    }

    expect(cards).toEqual(expected)
  })

  test('a 2v2 lobby gives one card per team with the team standing', async () => {
    const { reads, calls } = fakeLobbyReads({
      profiles: [
        rankedProfile({ ...sandstorm, fixedTeams: [snapshotFixedTeam(40218877, 91913839, pairStanding)] }),
        rankedProfile({ ...tidewater, fixedTeams: [snapshotFixedTeam(40218877, 91913839, olderPairStanding)] }),
      ],
      names,
      regionRanks: { 91913839: 48, 40218877: 12 },
    })

    const cards = await lobbyCards(reads, pairLobby)

    expect(cards).toEqual(contractFixture('2v2'))
    expect(calls.readBoardRanks).toEqual([])
  })

  test('takes the team standing from the member refreshed last', async () => {
    const laterTidewater = { ...tidewater, lastSuccessAt: new Date('2026-11-16T11:00:00.000Z') }

    const { reads } = fakeLobbyReads({
      profiles: [
        rankedProfile({ ...sandstorm, fixedTeams: [snapshotFixedTeam(40218877, 91913839, olderPairStanding)] }),
        rankedProfile({ ...laterTidewater, fixedTeams: [snapshotFixedTeam(40218877, 91913839, pairStanding)] }),
      ],
      names,
    })

    const cards = await lobbyCards(reads, pairLobby)

    expect(cards.cards[0].teamStanding).toEqual(pairStanding)
  })

  test('has no team standing when a member has a profile that does not list the pair', async () => {
    const { reads, calls } = fakeLobbyReads({
      profiles: [rankedProfile(sandstorm)],
      standings: [leaderboardRow(tidewater)],
      teams: [observedPair(pairStanding)],
      names,
    })

    const cards = await lobbyCards(reads, pairLobby)

    expect(cards.cards[0].teamStanding).toBeNull()
    expect(calls.teamStandingByPair).toEqual([])
  })

  test('uses the observed team only when neither member has a profile', async () => {
    const { reads, calls } = fakeLobbyReads({
      standings: [leaderboardRow(sandstorm), leaderboardRow(tidewater)],
      teams: [observedPair({ ...pairStanding, tier: null })],
      names,
    })

    const cards = await lobbyCards(reads, pairLobby)

    expect(cards.cards[0].teamStanding).toEqual({ ...pairStanding, tier: null })
    expect(calls.teamStandingByPair).toEqual([[91913839, 40218877]])

    expect(cards.cards[0].players.map((player) => player.refreshedAt)).toEqual([
      observedAt.toISOString(),
      observedAt.toISOString(),
    ])
  })

  test('orders 2v2 cards by the first player of each team and asks no pair for a lone player', async () => {
    const { reads, calls } = fakeLobbyReads({ names })

    const cards = await lobbyCards(reads, {
      matchType: '2v2',
      players: [
        { brawlhallaId: 40218877, team: 3 },
        { brawlhallaId: 60417325, team: 2 },
        { brawlhallaId: 91913839, team: 3 },
      ],
    })

    const teams = cards.cards.map((card) => ({
      team: card.team,
      players: card.players.map((player) => player.brawlhallaId),
      teamStanding: card.teamStanding,
    }))

    expect(teams).toEqual([
      { team: 3, players: [40218877, 91913839], teamStanding: null },
      { team: 2, players: [60417325], teamStanding: null },
    ])

    expect(calls.teamStandingByPair).toEqual([[40218877, 91913839]])
  })

  test('asks no board for a region that has none', async () => {
    const { reads, calls } = fakeLobbyReads({
      profiles: [rankedProfile({ ...sandstorm, region: '' })],
      regionRanks: { 91913839: 48, 60417325: 3 },
    })

    const cards = await lobbyCards(reads, {
      matchType: '1v1',
      players: [
        { brawlhallaId: 91913839, team: 2 },
        { brawlhallaId: 60417325, team: 3 },
      ],
    })

    expect(calls.readBoardRanks).toEqual([])
    expect(cards.cards.map((card) => card.players[0].regionRank)).toEqual([null, null])
    expect(cards.cards.map((card) => card.players[0].region)).toEqual([null, null])
  })

  test('ranks a player known only from leaderboard rows on their stored region', async () => {
    const { reads, calls } = fakeLobbyReads({
      standings: [leaderboardRow(tidewater)],
      names,
      regionRanks: { 40218877: 12 },
    })

    const cards = await lobbyCards(reads, { matchType: '1v1', players: [{ brawlhallaId: 40218877, team: 2 }] })
    const [player] = cards.cards[0].players

    expect(calls.readBoardRanks).toEqual([{ brawlhallaId: 40218877, region: 'US-E' }])
    expect(player.regionRank).toBe(12)
    expect(player.region).toBe('US-E')
    expect(player.known).toBe(true)
    expect(player.refreshedAt).toBe(observedAt.toISOString())
  })

  test('fails the whole lobby when one player read fails', async () => {
    const { reads } = fakeLobbyReads({ profiles: [rankedProfile(sandstorm)], names })

    const failingReads: LobbyReads = {
      ...reads,
      rankedPlayers: {
        byId: (brawlhallaId) =>
          brawlhallaId === 40218877
            ? Promise.reject(new Error('ranked players unavailable'))
            : reads.rankedPlayers.byId(brawlhallaId),
      },
    }

    await expect(readStoredLobby(failingReads, pairLobby)).rejects.toThrow('ranked players unavailable')
  })

  test('fails the whole lobby when a board read fails', async () => {
    const { reads } = fakeLobbyReads({ profiles: [rankedProfile(sandstorm)], names })
    const failingReads = { ...reads, readBoardRanks: () => Promise.reject(new Error('board ranks unavailable')) }
    const input: DesktopLobbyInputContract = { matchType: '1v1', players: [{ brawlhallaId: 91913839, team: 2 }] }

    await expect(readStoredLobby(failingReads, input)).rejects.toThrow('board ranks unavailable')
  })
})

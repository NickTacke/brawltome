import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { brawlhallaV0RequestLimit } from '@brawltome/bhapi'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  createPlayerRefreshReservations,
  createPostgresCareerPlayers,
  createPostgresLeaderboardRanked,
  createPostgresPlayerReferences,
  createPostgresRankedPlayers,
  playerModule,
} from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { rankingModule, readPlayerBoardRanks } from '@brawltome/ranking'
import { createPostgresRequestAdmission, requestAdmissionModule } from '@brawltome/request-admission'
import { createTelemetry } from '@brawltome/telemetry'
import { readMinimumDesktopVersion } from '../src/desktop/desktop-version'
import { createDesktopRefresher } from '../src/desktop/request-refresh'
import { createDesktopV1Routes, lobbiesPerMinute } from '../src/routes/desktop-v1.routes'
import { createVisitLimiter } from '../src/visits'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'desktop_lobby',
    modules: [queueModule, playerModule, rankingModule, requestAdmissionModule],
  })
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

const observedAt = new Date('2026-11-16T08:00:00.000Z')

// the route over the same factories serve.ts builds it from
function createLobbyApp() {
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
  const careerPlayers = createPostgresCareerPlayers(database)

  const rankedPlayers = createPostgresRankedPlayers(database, {
    resolveCareerMainLegend: (brawlhallaId) => careerPlayers.mainLegendById(brawlhallaId),
  })

  const requestAdmission = createPostgresRequestAdmission(database, {
    authenticatedIpLimit: 120,
    sourceLimits: { 'brawlhalla-v0': brawlhallaV0RequestLimit },
  })

  const refresher = createDesktopRefresher({
    playerRefreshReservations: createPlayerRefreshReservations(database),
    requestAdmission,
    telemetry,
  })

  return createDesktopV1Routes({
    minimumVersion: readMinimumDesktopVersion(undefined),
    lobbyReads: {
      rankedPlayers,
      playerReferences: createPostgresPlayerReferences(database),
      leaderboardStandings: createPostgresLeaderboardRanked(database),
      readBoardRanks: (input) => readPlayerBoardRanks(database.sql, input),
    },
    refresher,
    lobbyLimiter: createVisitLimiter(lobbiesPerMinute, Date.now),
    telemetry,
  })
}

async function sendLobby(app: ReturnType<typeof createLobbyApp>, lobby: unknown) {
  const headers = { 'content-type': 'application/json', 'x-desktop-version': '0.2.0', 'x-client-ip': '203.0.113.42' }
  const response = await app.request('/lobby', { method: 'POST', headers, body: JSON.stringify(lobby) })

  expect(response.status).toBe(200)

  return response.json()
}

function standing(rating: number) {
  return { region: 'EU', rating, peakRating: 2100, tier: 'Diamond', wins: 40, games: 70 }
}

async function countRefreshes(brawlhallaId: number): Promise<number> {
  const [row] = await database.sql<{ count: number }[]>`
    SELECT count(*)::integer AS count FROM queue.operations
    WHERE kind = 'interactive-player-refresh' AND resource_key = ${`player:${brawlhallaId}`}
  `

  return row.count
}

describe('desktop lobby over the database', () => {
  test('reads a card for a player known only from the leaderboard crawl', async () => {
    const standings = createPostgresLeaderboardRanked(database)

    await standings.applyLeaderboardRanked({ observedAt, players: [{ brawlhallaId: 800, ...standing(2050) }] })

    const lobby = await sendLobby(createLobbyApp(), { matchType: '1v1', players: [{ brawlhallaId: 800, team: 2 }] })
    const [player] = lobby.cards[0].players

    expect(player).toMatchObject({ brawlhallaId: 800, known: true, region: 'EU', regionRank: null })
    expect(player.oneVsOne.rating).toBe(2050)
  })

  test('reads a 2v2 team card from the crawl when neither player has a profile', async () => {
    const standings = createPostgresLeaderboardRanked(database)

    await standings.applyLeaderboardTeams({
      observedAt,
      teams: [{ brawlhallaIdOne: 810, brawlhallaIdTwo: 811, ...standing(1975) }],
    })

    const lobby = await sendLobby(createLobbyApp(), {
      matchType: '2v2',
      players: [
        { brawlhallaId: 810, team: 1 },
        { brawlhallaId: 811, team: 1 },
      ],
    })

    expect(lobby.cards).toHaveLength(1)
    expect(lobby.cards[0].teamStanding.rating).toBe(1975)
    expect(lobby.cards[0].players.map((player: { known: boolean }) => player.known)).toEqual([false, false])
  })

  test('queues one interactive refresh per unknown player', async () => {
    const app = createLobbyApp()
    const lobby = { matchType: '1v1', players: [{ brawlhallaId: 820, team: 2 }] }

    const first = await sendLobby(app, lobby)

    expect(first.cards[0].players[0].isRefreshing).toBe(true)
    expect(await countRefreshes(820)).toBe(1)

    await sendLobby(app, lobby)

    expect(await countRefreshes(820)).toBe(1)
  })
})

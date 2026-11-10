import {
  leaderboardOutputSchema,
  leaderboardPageInputSchema,
  leaderboardPageSize,
  leaderboardRecentActivityOutputSchema,
  leaderboardRecentMoversInputSchema,
  leaderboardRecentMoversOutputSchema,
  nullablePlayerValhallanEvidenceSchema,
  playerBoardRanksInputSchema,
  playerBoardRanksSchema,
  playerReferenceByIdInputSchema,
} from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { createPostgresPlayerReferences } from '@brawltome/player'
import { readPlayerBoardRanks } from '../db/player-board-ranks'
import { createPostgresRanking } from '../postgres'
import { readNamedLeaderboard } from './read-named-leaderboard'
import { readNamedRecentActivity, readNamedRecentMovers } from './read-named-recent-activity'

/** The ranking reads the API serves under ranking, at /rpc/ranking/* and /v1. Only internal callers get them. */
export function createRankingProcedures(runtime: ModuleRuntime) {
  const { queries } = createPostgresRanking(runtime.database)
  const references = createPostgresPlayerReferences(runtime.database)

  const valhallanEvidenceById = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{id}/valhallan-evidence',
      operationId: 'ranking.valhallanEvidenceById',
      summary: 'Valhallan boards a player is on',
      tags: ['ranking'],
    })
    .input(playerReferenceByIdInputSchema)
    .output(nullablePlayerValhallanEvidenceSchema)
    .handler(({ input }) => queries.playerValhallanEvidenceById(input.id))

  const boardRanksById = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{id}/board-ranks',
      operationId: 'ranking.boardRanksById',
      summary: "A player's place on the global 1v1 board and on the board of one region",
      tags: ['ranking'],
    })
    .input(playerBoardRanksInputSchema)
    .output(playerBoardRanksSchema)
    .handler(({ input }) =>
      readPlayerBoardRanks(runtime.database.sql, { brawlhallaId: input.id, region: input.region ?? null }),
    )

  const leaderboardPage = internalProcedure
    .route({
      method: 'GET',
      path: '/leaderboards/{mode}/{region}',
      operationId: 'ranking.leaderboardPage',
      summary: 'One page of a ranked leaderboard',
      tags: ['ranking'],
    })
    .input(leaderboardPageInputSchema)
    .output(leaderboardOutputSchema)
    .handler(({ input }) => readNamedLeaderboard(queries, references, { ...input, pageSize: leaderboardPageSize }))

  const recentActivityPage = internalProcedure
    .route({
      method: 'GET',
      path: '/leaderboards/{mode}/{region}/recent-activity',
      operationId: 'ranking.recentActivityPage',
      summary: 'One page of who played on a board in the last hour',
      tags: ['ranking'],
    })
    .input(leaderboardPageInputSchema)
    .output(leaderboardRecentActivityOutputSchema)
    .handler(({ input }) => readNamedRecentActivity(queries, references, { ...input, pageSize: leaderboardPageSize }))

  const recentActivityMovers = internalProcedure
    .route({
      method: 'GET',
      path: '/leaderboards/{mode}/{region}/recent-movers',
      operationId: 'ranking.recentActivityMovers',
      summary: 'Biggest climbers, drops and most games on a board in the last hour',
      tags: ['ranking'],
    })
    .input(leaderboardRecentMoversInputSchema)
    .output(leaderboardRecentMoversOutputSchema)
    .handler(({ input }) => readNamedRecentMovers(queries, references, input))

  return { valhallanEvidenceById, boardRanksById, leaderboardPage, recentActivityPage, recentActivityMovers }
}

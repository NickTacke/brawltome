import {
  leaderboardOutputSchema,
  leaderboardPageInputSchema,
  leaderboardPageSize,
  nullablePlayerValhallanEvidenceSchema,
  playerReferenceByIdInputSchema,
} from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { createPostgresPlayerReferences } from '@brawltome/player'
import { createPostgresRanking } from '../postgres'
import { readNamedLeaderboard } from './read-named-leaderboard'

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

  return { valhallanEvidenceById, leaderboardPage }
}

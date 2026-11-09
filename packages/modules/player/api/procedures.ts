import { playerRankedSummariesInputSchema, playerRankedSummariesSchema } from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { readRankedSummaries } from '../db/read-ranked-summaries'

/** The player reads the API serves under player, at /rpc/player/* and /v1. Only internal callers get them. */
export function createPlayerProcedures(runtime: ModuleRuntime) {
  const { database } = runtime

  const rankedSummaries = internalProcedure
    .route({
      method: 'POST',
      path: '/players/ranked-summaries',
      operationId: 'player.rankedSummaries',
      summary: 'Ranked summaries of several players',
      tags: ['player'],
    })
    .input(playerRankedSummariesInputSchema)
    .output(playerRankedSummariesSchema)
    .handler(({ input }) => readRankedSummaries(database, input.ids))

  return { rankedSummaries }
}

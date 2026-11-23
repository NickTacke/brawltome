import { playerEsportsSchema, playerReferenceByIdInputSchema } from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { readPlayerEsports } from './read-player-esports'

/** The esports reads the API serves under esports, at /rpc/esports/* and /v1. Only internal callers get them. */
export function createEsportsProcedures(runtime: ModuleRuntime) {
  const byPlayerId = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{id}/esports',
      operationId: 'esports.byPlayerId',
      summary: "A player's esports results from Brawltools",
      tags: ['esports'],
    })
    .input(playerReferenceByIdInputSchema)
    .output(playerEsportsSchema)
    .handler(({ input }) => readPlayerEsports(runtime.database, input.id, new Date()))

  return { byPlayerId }
}

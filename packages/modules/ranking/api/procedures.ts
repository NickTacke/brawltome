import { nullablePlayerValhallanEvidenceSchema, playerReferenceByIdInputSchema } from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { createPostgresRanking } from '../postgres'

/** The ranking reads the API serves under ranking, at /rpc/ranking/* and /v1. Only internal callers get them. */
export function createRankingProcedures(runtime: ModuleRuntime) {
  const { queries } = createPostgresRanking(runtime.database)

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

  return { valhallanEvidenceById }
}

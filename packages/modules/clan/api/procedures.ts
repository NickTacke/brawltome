import {
  clanByIdInputSchema,
  clanProfileSchema,
  playerClanMembershipSchema,
  playerReferenceByIdInputSchema,
} from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { createPostgresClans } from '../db/postgres-clans'
import { readClanProfile } from './read-clan-profile'
import { readPlayerClanMembership } from './read-player-clan-membership'

/** The clan reads the API serves under clan, at /rpc/clan/* and /v1. Like on tRPC, only internal callers get them. */
export function createClanProcedures(runtime: ModuleRuntime) {
  const clans = createPostgresClans(runtime.database)

  const byId = internalProcedure
    .route({ method: 'GET', path: '/clans/{id}', operationId: 'clan.byId', summary: 'Clan profile', tags: ['clan'] })
    .input(clanByIdInputSchema)
    .output(clanProfileSchema.nullable())
    .handler(({ input }) => readClanProfile(clans, input.id))

  const membershipByPlayerId = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{id}/clan',
      operationId: 'clan.membershipByPlayerId',
      summary: 'Clan of a player',
      tags: ['clan'],
    })
    .input(playerReferenceByIdInputSchema)
    .output(playerClanMembershipSchema.nullable())
    .handler(({ input }) => readPlayerClanMembership(clans, input.id))

  return { byId, membershipByPlayerId }
}

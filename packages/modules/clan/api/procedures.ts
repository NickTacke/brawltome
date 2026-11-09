import {
  clanByIdInputSchema,
  clanProfileSchema,
  clanStandingSchema,
  playerClanMembershipSchema,
  playerReferenceByIdInputSchema,
  rankedClanListInputSchema,
  rankedClanListSchema,
} from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { readClanStanding } from '../db/read-clan-standing'
import { readClanProfile } from './read-clan-profile'
import { readPlayerClanMembership } from './read-player-clan-membership'
import { readRankedClans } from './read-ranked-clans'

/** The clan reads the API serves under clan, at /rpc/clan/* and /v1. Like on tRPC, only internal callers get them. */
export function createClanProcedures(runtime: ModuleRuntime) {
  const { database } = runtime

  const byId = internalProcedure
    .route({ method: 'GET', path: '/clans/{id}', operationId: 'clan.byId', summary: 'Clan profile', tags: ['clan'] })
    .input(clanByIdInputSchema)
    .output(clanProfileSchema.nullable())
    .handler(({ input }) => readClanProfile(database, input.id))

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
    .handler(({ input }) => readPlayerClanMembership(database, input.id))

  const standingById = internalProcedure
    .route({
      method: 'GET',
      path: '/clans/{id}/standing',
      operationId: 'clan.standingById',
      summary: 'Clan standing',
      tags: ['clan'],
    })
    .input(clanByIdInputSchema)
    .output(clanStandingSchema.nullable())
    .handler(({ input }) => readClanStanding(database, input.id))

  const rankedList = internalProcedure
    .route({
      method: 'GET',
      path: '/clans',
      operationId: 'clan.rankedList',
      summary: 'Guilds ranked by guild points',
      tags: ['clan'],
    })
    .input(rankedClanListInputSchema)
    .output(rankedClanListSchema)
    .handler(({ input }) => readRankedClans(database, input.page))

  return { byId, membershipByPlayerId, standingById, rankedList }
}

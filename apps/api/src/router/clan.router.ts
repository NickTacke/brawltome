import { readClanProfile, readPlayerClanMembership } from '@brawltome/clan'
import {
  type ClanRefreshResponseContract,
  clanByIdInputSchema,
  clanProfileSchema,
  clanRefreshInputSchema,
  clanRefreshResponseSchema,
  type DiscordClanRefreshInputContract,
  discordClanRefreshInputSchema,
  playerClanMembershipSchema,
  playerReferenceByIdInputSchema,
} from '@brawltome/contracts'
import { requestClanRefresh } from '../clan-refresh-request'
import type { Context } from '../trpc/context'
import { discordBotProcedure, internalProcedure, router } from '../trpc/trpc'

function requestDiscordClanRefresh(
  ctx: Context,
  input: DiscordClanRefreshInputContract,
  now: number,
): Promise<ClanRefreshResponseContract> {
  return requestClanRefresh(ctx, { id: input.id }, input.discordUserId, now)
}

export function createClanRouter(
  procedure = internalProcedure,
  discordProcedure = discordBotProcedure,
  now: () => number = Date.now,
) {
  return router({
    byId: procedure
      .input(clanByIdInputSchema)
      .output(clanProfileSchema.nullable())
      .query(({ ctx, input }) => readClanProfile(ctx.database, input.id)),
    membershipByPlayerId: procedure
      .input(playerReferenceByIdInputSchema)
      .output(playerClanMembershipSchema.nullable())
      .query(({ ctx, input }) => readPlayerClanMembership(ctx.database, input.id)),
    refresh: procedure
      .input(clanRefreshInputSchema)
      .output(clanRefreshResponseSchema)
      .mutation(({ ctx, input }) => requestClanRefresh(ctx, input, undefined, now())),
    refreshDiscord: discordProcedure
      .input(discordClanRefreshInputSchema)
      .output(clanRefreshResponseSchema)
      .mutation(({ ctx, input }) => requestDiscordClanRefresh(ctx, input, now())),
  })
}

export const clanRouter = createClanRouter()

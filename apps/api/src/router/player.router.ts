import {
  type DiscordPlayerRefreshInputContract,
  discordPlayerRefreshInputSchema,
  type PlayerRefreshResponseContract,
  playerRefreshInputSchema,
  playerRefreshResponseSchema,
  playerViewInputSchema,
} from '@brawltome/contracts'
import { z } from 'zod'
import { requestPlayerRefresh } from '../player-refresh-request'
import { recordProfileView } from '../profile-view-request'
import type { Context } from '../trpc/context'
import { discordBotProcedure, internalProcedure, mergeRouters, router } from '../trpc/trpc'
import { createPlayerCareerRouter } from './player-career.router'
import { createPlayerRankedRouter } from './player-ranked.router'
import { createPlayerReferenceRouter } from './player-reference.router'

const v2RefreshInputSchema = z.object({ id: z.number().int().positive(), turnstileToken: z.string() }).strict()

function requestDiscordPlayerRefresh(
  ctx: Context,
  input: DiscordPlayerRefreshInputContract,
  now: number,
): Promise<PlayerRefreshResponseContract> {
  return requestPlayerRefresh(ctx, { id: input.id }, input.discordUserId, now)
}

export function createCanonicalPlayerRefreshRouter(
  procedure = internalProcedure,
  discordProcedure = discordBotProcedure,
  now: () => number = Date.now,
) {
  return router({
    requestRefresh: procedure
      .input(playerRefreshInputSchema)
      .output(playerRefreshResponseSchema)
      .mutation(({ ctx, input }) => requestPlayerRefresh(ctx, input, undefined, now())),
    refreshDiscord: discordProcedure
      .input(discordPlayerRefreshInputSchema)
      .output(playerRefreshResponseSchema)
      .mutation(({ ctx, input }) => requestDiscordPlayerRefresh(ctx, input, now())),
  })
}

export function createV2PlayerRefreshRouter(procedure = internalProcedure) {
  return router({
    refresh: procedure.input(v2RefreshInputSchema).mutation(async ({ ctx, input }) => {
      const result = await requestPlayerRefresh(ctx, input)

      return {
        isRefreshing: result.refresh.outcome === 'accepted' || result.refresh.outcome === 'alreadyRefreshing',
      }
    }),
  })
}

export function createPlayerViewRouter(procedure = internalProcedure) {
  return router({
    recordView: procedure.input(playerViewInputSchema).mutation(({ ctx, input }) => recordProfileView(ctx, input.id)),
  })
}

export const playerRouter = mergeRouters(
  createPlayerReferenceRouter(),
  createPlayerRankedRouter(),
  createPlayerCareerRouter(),
  createCanonicalPlayerRefreshRouter(),
  createV2PlayerRefreshRouter(),
  createPlayerViewRouter(),
)

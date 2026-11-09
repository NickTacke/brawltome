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
import type { Context } from '../trpc/context'
import { discordBotProcedure, internalProcedure, mergeRouters, router } from '../trpc/trpc'
import { createPlayerCareerRouter } from './player-career.router'
import { createPlayerRankedRouter } from './player-ranked.router'
import { createPlayerReferenceRouter } from './player-reference.router'

const v2RefreshInputSchema = z.object({ id: z.number().int().positive(), turnstileToken: z.string() }).strict()

function recordTelemetry(record: () => void): void {
  try {
    record()
  } catch {
    return
  }
}

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

// Counts a profile view for background refresh demand. Bots are not demand, and each visitor has a view budget (no
// challenge: over it the view is simply not counted); failures never reach the visitor.
export function createPlayerViewRouter(procedure = internalProcedure) {
  return router({
    recordView: procedure.input(playerViewInputSchema).mutation(async ({ ctx, input }) => {
      if (ctx.isBot || !ctx.profileViews) return { recorded: false }

      try {
        const admission = await ctx.requestAdmission.admitActorOnce({ kind: 'profile-view', ip: ctx.clientIp })

        if (admission.outcome !== 'admitted') return { recorded: false }

        await ctx.profileViews.recordView(input.id)

        return { recorded: true }
      } catch (error) {
        recordTelemetry(() => ctx.telemetry.logger.error('player.view.record_failed', error))

        return { recorded: false }
      }
    }),
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

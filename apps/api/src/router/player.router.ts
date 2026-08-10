import {
  type PlayerRefreshInputContract,
  type PlayerRefreshResponseContract,
  playerRefreshInputSchema,
  playerRefreshResponseSchema,
} from '@brawltome/contracts'
import { CAREER_FRESHNESS_SECONDS, RANKED_FRESHNESS_SECONDS } from '@brawltome/player'
import { getV2PlayerProfile, isStale } from '@brawltome/player/v2-compatibility'
import { z } from 'zod'
import { requestInteractivePlayerRefresh } from '../interactive-player-refresh'
import type { Context } from '../trpc/context'
import { internalProcedure, mergeRouters, router } from '../trpc/trpc'
import { createPlayerCareerRouter } from './player-career.router'
import { createPlayerRankedRouter } from './player-ranked.router'
import { createPlayerReferenceRouter } from './player-reference.router'

const v2RefreshInputSchema = z.object({ id: z.number().int().positive(), turnstileToken: z.string() }).strict()
const temporarilyUnavailable = {
  outcome: 'temporarilyUnavailable' as const,
  retry: { kind: 'after' as const, afterSeconds: 30 },
}

function recordTelemetry(record: () => void): void {
  try {
    record()
  } catch {
    return
  }
}

function timestamp(value: Date | string | null | undefined): number {
  if (!value) return 0
  const milliseconds = new Date(value).getTime()
  return Number.isFinite(milliseconds) ? milliseconds : 0
}

async function requestPlayerRefresh(
  ctx: Context,
  input: PlayerRefreshInputContract,
): Promise<PlayerRefreshResponseContract> {
  const [player, ranked, career] = await Promise.all([
    ctx.playerReferenceQueries.byId(input.id),
    ctx.rankedPlayerQueries.byId(input.id),
    ctx.careerPlayerQueries.byId(input.id),
  ])
  const rankedStale = !ranked?.lastSuccessAt || isStale(ranked.lastSuccessAt, RANKED_FRESHNESS_SECONDS * 1_000)
  const statsStale = !career?.lastSuccessAt || isStale(career.lastSuccessAt, CAREER_FRESHNESS_SECONDS * 1_000)
  if (!rankedStale && !statsStale) {
    return { player, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }
  }

  const staleSections = [rankedStale ? ('ranked' as const) : null, statsStale ? ('stats' as const) : null].filter(
    (section): section is 'ranked' | 'stats' => section !== null,
  )
  const dedupeKey = [
    'player',
    input.id,
    `ranked:${timestamp(ranked?.lastSuccessAt)}`,
    `stats:${timestamp(career?.lastSuccessAt)}`,
  ].join(':')

  const refresh = await requestInteractivePlayerRefresh({
    brawlhallaId: input.id,
    dedupeKey,
    staleSections,
    provenance: { source: 'interactive-api', requestedBy: ctx.account?.id },
    refreshOperations: ctx.refreshOperations,
    requestAdmission: ctx.requestAdmission,
    resolveActor: async () => {
      if (ctx.account) {
        return { kind: 'authenticated', accountId: ctx.account.id, ip: ctx.clientIp }
      }
      if (!ctx.refreshTrust.trusted) {
        if (!input.turnstileToken) {
          return { outcome: 'verificationRequired', retry: { kind: 'verify' } }
        }
        const verification = await ctx.verifyRefreshChallenge(input.turnstileToken, ctx.clientIp)
        if (verification === 'unavailable') return temporarilyUnavailable
        if (verification === 'invalid') {
          return { outcome: 'verificationRequired', retry: { kind: 'verify' } }
        }
        ctx.refreshTrust.grant()
      }
      return { kind: 'verified-anonymous', ip: ctx.clientIp }
    },
    onError: (error) =>
      recordTelemetry(() =>
        ctx.telemetry.logger.error('refresh.request.failed', error, { kind: 'interactive-player-refresh' }),
      ),
  })
  if (refresh.outcome === 'accepted') {
    recordTelemetry(() =>
      ctx.telemetry.logger.info('refresh.operation.accepted', {
        operationId: refresh.operationId,
        kind: 'interactive-player-refresh',
      }),
    )
  }
  return { player, refresh }
}

export function createCanonicalPlayerRefreshRouter(procedure = internalProcedure) {
  return router({
    requestRefresh: procedure
      .input(playerRefreshInputSchema)
      .output(playerRefreshResponseSchema)
      .mutation(({ ctx, input }) => requestPlayerRefresh(ctx, input)),
  })
}

export function createV2PlayerRefreshRouter(procedure = internalProcedure) {
  return router({
    byId: procedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const [player, clan] = await Promise.all([
        getV2PlayerProfile(ctx.playerRepo, input.id),
        ctx.clanRepo.getPlayerMembership(input.id),
      ])
      return player ? { ...player, clan } : null
    }),
    refresh: procedure.input(v2RefreshInputSchema).mutation(async ({ ctx, input }) => {
      const result = await requestPlayerRefresh(ctx, input)
      return {
        isRefreshing: result.refresh.outcome === 'accepted' || result.refresh.outcome === 'alreadyRefreshing',
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
)

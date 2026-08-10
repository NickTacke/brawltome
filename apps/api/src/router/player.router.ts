import {
  type PlayerRefreshInputContract,
  type PlayerRefreshResponseContract,
  playerRefreshInputSchema,
  playerRefreshResponseSchema,
} from '@brawltome/contracts'
import { getV2PlayerProfile, isStale } from '@brawltome/player/v2-compatibility'
import { TIERED_TTL } from '@brawltome/shared'
import { z } from 'zod'
import type { Context } from '../trpc/context'
import { internalProcedure, mergeRouters, router } from '../trpc/trpc'
import { createPlayerRankedRouter } from './player-ranked.router'
import { createPlayerReferenceRouter } from './player-reference.router'

const v2RefreshInputSchema = z.object({ id: z.number().int().positive(), turnstileToken: z.string() }).strict()
const temporarilyUnavailable = {
  outcome: 'temporarilyUnavailable' as const,
  retry: { kind: 'after' as const, afterSeconds: 30 },
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
  const [player, stored, ranked] = await Promise.all([
    ctx.playerReferenceQueries.byId(input.id),
    ctx.playerRepo.findById(input.id),
    ctx.rankedPlayerQueries.byId(input.id),
  ])
  const rankedStale = !ranked?.lastSuccessAt || isStale(ranked.lastSuccessAt, TIERED_TTL.hot.ranked)
  const statsStale = !stored || isStale(stored.statsLastUpdated, TIERED_TTL.hot.stats)
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
    `stats:${timestamp(stored?.statsLastUpdated)}`,
  ].join(':')

  try {
    const active = await ctx.refreshOperations.findActiveInteractivePlayerRefresh(dedupeKey)
    if (active) {
      if (active.awaitingAdmission) {
        if (await ctx.requestAdmission.hasActorReservation(active.operationId)) {
          await ctx.refreshOperations.activateAdmittedInteractiveRefresh(active.operationId)
        } else if (active.reservationExpired) {
          await ctx.refreshOperations.rejectExpiredInteractiveRefresh(active.operationId)
        } else {
          return {
            player,
            refresh: {
              outcome: 'alreadyRefreshing',
              operationId: active.operationId,
              retry: { kind: 'poll', afterSeconds: 2 },
            },
          }
        }
      }
      if (!active.reservationExpired || (await ctx.requestAdmission.hasActorReservation(active.operationId))) {
        return {
          player,
          refresh: {
            outcome: 'alreadyRefreshing',
            operationId: active.operationId,
            retry: { kind: 'poll', afterSeconds: 2 },
          },
        }
      }
    }

    let actor: Parameters<Context['requestAdmission']['admitActor']>[0]
    if (ctx.account) {
      actor = { kind: 'authenticated', accountId: ctx.account.id, ip: ctx.clientIp }
    } else {
      if (!ctx.refreshTrust.trusted) {
        if (!input.turnstileToken) {
          return { player, refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } } }
        }
        const verification = await ctx.verifyRefreshChallenge(input.turnstileToken, ctx.clientIp)
        if (verification === 'unavailable') return { player, refresh: temporarilyUnavailable }
        if (verification === 'invalid') {
          return { player, refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } } }
        }
        ctx.refreshTrust.grant()
      }
      actor = { kind: 'verified-anonymous', ip: ctx.clientIp }
    }

    const reserved = await ctx.refreshOperations.reserveInteractivePlayerRefresh({
      dedupeKey,
      operationKey: dedupeKey,
      brawlhallaId: input.id,
      staleSections,
      provenance: { source: 'interactive-api', requestedBy: ctx.account?.id },
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome === 'already-active') {
      return {
        player,
        refresh: {
          outcome: 'alreadyRefreshing',
          operationId: reserved.operationId,
          retry: { kind: 'poll', afterSeconds: 2 },
        },
      }
    }

    const actorAdmission = await ctx.requestAdmission.admitActor(actor, reserved.operationId)
    if (actorAdmission.outcome === 'rate-limited') {
      await ctx.refreshOperations.rejectInteractiveRefresh(
        reserved.operationId,
        reserved.reservationToken,
        'actor_rate_limited',
      )
      return {
        player,
        refresh: {
          outcome: 'rateLimited',
          retry: { kind: 'after', afterSeconds: actorAdmission.retryAfterSeconds },
        },
      }
    }

    const activated = await ctx.refreshOperations.activateInteractiveRefresh(
      reserved.operationId,
      reserved.reservationToken,
    )
    if (activated === 'lease-lost') return { player, refresh: temporarilyUnavailable }
    return {
      player,
      refresh: {
        outcome: 'accepted',
        operationId: reserved.operationId,
        retry: { kind: 'poll', afterSeconds: 2 },
      },
    }
  } catch {
    return { player, refresh: temporarilyUnavailable }
  }
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
  createCanonicalPlayerRefreshRouter(),
  createV2PlayerRefreshRouter(),
)

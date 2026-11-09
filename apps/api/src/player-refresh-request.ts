import type { PlayerRefreshInputContract, PlayerRefreshResponseContract } from '@brawltome/contracts'
import { CAREER_FRESHNESS_SECONDS, RANKED_FRESHNESS_SECONDS } from '@brawltome/player'
import { requestInteractivePlayerRefresh } from './interactive-player-refresh'
import type { Context } from './trpc/context'

/** What a player refresh request needs from the caller, so tRPC and oRPC can both make one. */
export type PlayerRefreshContext = Pick<
  Context,
  | 'telemetry'
  | 'playerReferenceQueries'
  | 'rankedPlayerQueries'
  | 'careerPlayerQueries'
  | 'playerRefreshReservations'
  | 'requestAdmission'
  | 'refreshTrust'
  | 'verifyRefreshChallenge'
  | 'account'
  | 'clientIp'
>

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

export async function requestPlayerRefresh(
  ctx: PlayerRefreshContext,
  input: PlayerRefreshInputContract,
  discordUserId?: string,
  now = Date.now(),
): Promise<PlayerRefreshResponseContract> {
  const response = await resolvePlayerRefresh(ctx, input, discordUserId, now)

  recordTelemetry(() =>
    ctx.telemetry.metrics.add('refresh_requests_total', 1, {
      kind: 'player',
      outcome: response.refresh.outcome,
      source: discordUserId ? 'discord' : 'interactive-api',
    }),
  )

  return response
}

async function resolvePlayerRefresh(
  ctx: PlayerRefreshContext,
  input: PlayerRefreshInputContract,
  discordUserId: string | undefined,
  now: number,
): Promise<PlayerRefreshResponseContract> {
  const [player, ranked, career] = await Promise.all([
    ctx.playerReferenceQueries.byId(input.id),
    ctx.rankedPlayerQueries.byId(input.id),
    ctx.careerPlayerQueries.byId(input.id),
  ])

  const rankedStale = !ranked?.lastSuccessAt || now - ranked.lastSuccessAt.getTime() > RANKED_FRESHNESS_SECONDS * 1_000

  const statsStale =
    career?.snapshotSource === 'legacy-v2' ||
    !career?.lastSuccessAt ||
    now - career.lastSuccessAt.getTime() > CAREER_FRESHNESS_SECONDS * 1_000

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
    `sections:${staleSections.join(',')}`,
  ].join(':')

  const refresh = await requestInteractivePlayerRefresh({
    brawlhallaId: input.id,
    dedupeKey,
    staleSections,
    provenance: {
      source: discordUserId ? 'discord' : 'interactive-api',
      requestedBy: discordUserId ?? ctx.account?.id,
    },
    playerRefreshReservations: ctx.playerRefreshReservations,
    requestAdmission: ctx.requestAdmission,
    resolveActor: async () => {
      if (discordUserId) return { kind: 'discord', discordUserId }

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

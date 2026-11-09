import { toClanProfileContract } from '@brawltome/clan'
import type { ClanRefreshInputContract, ClanRefreshResponseContract } from '@brawltome/contracts'
import type { Context } from './trpc/context'

/** What a clan refresh request needs from the caller, so tRPC and oRPC can both make one. */
export type ClanRefreshContext = Pick<
  Context,
  | 'telemetry'
  | 'clanRepo'
  | 'clanRefreshReservations'
  | 'requestAdmission'
  | 'refreshTrust'
  | 'verifyRefreshChallenge'
  | 'account'
  | 'clientIp'
>

const CLAN_TTL_MS = 60 * 60 * 1_000
const unavailable = { outcome: 'temporarilyUnavailable' as const, retry: { kind: 'after' as const, afterSeconds: 30 } }

function recordTelemetry(record: () => void): void {
  try {
    record()
  } catch {
    return
  }
}

function timestamp(value: Date | null | undefined): number {
  return value?.getTime() ?? 0
}

function stale(value: Date | null | undefined, now: number): boolean {
  return !value || now - value.getTime() > CLAN_TTL_MS
}

export async function requestClanRefresh(
  ctx: ClanRefreshContext,
  input: ClanRefreshInputContract,
  discordUserId?: string,
  now = Date.now(),
): Promise<ClanRefreshResponseContract> {
  const response = await resolveClanRefresh(ctx, input, discordUserId, now)

  recordTelemetry(() =>
    ctx.telemetry.metrics.add('refresh_requests_total', 1, {
      kind: 'clan',
      outcome: response.refresh.outcome,
      source: discordUserId ? 'discord' : 'interactive-api',
    }),
  )

  return response
}

async function resolveClanRefresh(
  ctx: ClanRefreshContext,
  input: ClanRefreshInputContract,
  discordUserId: string | undefined,
  now: number,
): Promise<ClanRefreshResponseContract> {
  // one read, so the staleness check and the returned clan come from the same commit
  const stored = await ctx.clanRepo.getById(input.id)
  const clan = stored ? toClanProfileContract(stored) : null

  const staleSections = [
    stale(stored?.profile.lastSuccessAt, now) ? ('profile' as const) : null,
    stale(stored?.roster?.lastSuccessAt, now) ? ('roster' as const) : null,
  ].filter((section): section is 'profile' | 'roster' => section !== null)

  if (staleSections.length === 0) return { clan, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }

  const dedupeKey = [
    'clan',
    input.id,
    `profile:${timestamp(stored?.profile.lastSuccessAt)}`,
    `roster:${timestamp(stored?.roster?.lastSuccessAt)}`,
    `sections:${staleSections.join(',')}`,
  ].join(':')

  try {
    const active = await ctx.clanRefreshReservations.findActiveClanRefresh(dedupeKey)

    if (
      active &&
      (!active.reservationExpired || (await ctx.requestAdmission.hasActorReservation(active.operationId)))
    ) {
      return {
        clan,
        refresh: {
          outcome: 'alreadyRefreshing',
          operationId: active.operationId,
          retry: { kind: 'poll', afterSeconds: 2 },
        },
      }
    }

    let actor: Parameters<ClanRefreshContext['requestAdmission']['admitActor']>[0]

    if (discordUserId) actor = { kind: 'discord', discordUserId }
    else if (ctx.account) actor = { kind: 'authenticated', accountId: ctx.account.id, ip: ctx.clientIp }
    else {
      if (!ctx.refreshTrust.trusted) {
        if (!input.turnstileToken) {
          return { clan, refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } } }
        }

        const verification = await ctx.verifyRefreshChallenge(input.turnstileToken, ctx.clientIp)

        if (verification === 'unavailable') return { clan, refresh: unavailable }

        if (verification === 'invalid') {
          return { clan, refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } } }
        }

        ctx.refreshTrust.grant()
      }

      actor = { kind: 'verified-anonymous', ip: ctx.clientIp }
    }

    const reserved = await ctx.clanRefreshReservations.reserveClanRefresh({
      dedupeKey,
      operationKey: dedupeKey,
      clanId: input.id,
      staleSections,
      provenance: {
        source: discordUserId ? 'discord' : 'interactive-api',
        requestedBy: discordUserId ?? ctx.account?.id,
      },
      reservationTtlSeconds: 30,
    })

    if (reserved.outcome === 'already-active') {
      return {
        clan,
        refresh: {
          outcome: 'alreadyRefreshing',
          operationId: reserved.operationId,
          retry: { kind: 'poll', afterSeconds: 2 },
        },
      }
    }

    const admission = await ctx.requestAdmission.admitActor(actor, reserved.operationId)

    if (admission.outcome === 'rate-limited') {
      await ctx.clanRefreshReservations.rejectClanRefresh(
        reserved.operationId,
        reserved.reservationToken,
        'actor_rate_limited',
      )

      return {
        clan,
        refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: admission.retryAfterSeconds } },
      }
    }

    if (
      (await ctx.clanRefreshReservations.activateClanRefresh(reserved.operationId, reserved.reservationToken)) ===
      'lease-lost'
    ) {
      return { clan, refresh: unavailable }
    }

    recordTelemetry(() =>
      ctx.telemetry.logger.info('refresh.operation.accepted', {
        operationId: reserved.operationId,
        kind: 'clan-refresh',
      }),
    )

    return {
      clan,
      refresh: { outcome: 'accepted', operationId: reserved.operationId, retry: { kind: 'poll', afterSeconds: 2 } },
    }
  } catch (error) {
    recordTelemetry(() => ctx.telemetry.logger.error('refresh.request.failed', error, { kind: 'clan-refresh' }))

    return { clan, refresh: unavailable }
  }
}

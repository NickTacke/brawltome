import type { ClanQueries } from '@brawltome/clan'
import {
  type ClanProfileContract,
  type ClanRefreshInputContract,
  type ClanRefreshResponseContract,
  type DiscordClanRefreshInputContract,
  clanByIdInputSchema,
  clanProfileSchema,
  clanRefreshInputSchema,
  clanRefreshResponseSchema,
  discordClanRefreshInputSchema,
} from '@brawltome/contracts'
import type { Context } from '../trpc/context'
import { discordBotProcedure, internalProcedure, router } from '../trpc/trpc'

const CLAN_TTL_MS = 60 * 60 * 1_000
const unavailable = { outcome: 'temporarilyUnavailable' as const, retry: { kind: 'after' as const, afterSeconds: 30 } }

function recordTelemetry(record: () => void): void {
  try {
    record()
  } catch {
    return
  }
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function publicProvenance(
  value: ClanProfileContract['profile']['checkProvenance'],
): ClanProfileContract['profile']['checkProvenance'] {
  return {
    source: value.source,
    outcome: value.outcome,
    ...(value.legacyTimestamp ? { legacyTimestamp: value.legacyTimestamp } : {}),
  }
}

export async function mapClan(clans: ClanQueries, clanId: number): Promise<ClanProfileContract | null> {
  const clan = await clans.getById(clanId)
  if (!clan) return null
  return clanProfileSchema.parse({
    ...clan,
    clanCreateDate: clan.clanCreateDate.toISOString(),
    profile: {
      ...clan.profile,
      checkedAt: iso(clan.profile.checkedAt),
      checkProvenance: publicProvenance(clan.profile.checkProvenance),
      lastSuccessAt: iso(clan.profile.lastSuccessAt),
      lastSuccessProvenance: clan.profile.lastSuccessProvenance
        ? publicProvenance(clan.profile.lastSuccessProvenance)
        : null,
    },
    roster: clan.roster
      ? {
          ...clan.roster,
          checkedAt: iso(clan.roster.checkedAt),
          checkProvenance: publicProvenance(clan.roster.checkProvenance),
          lastSuccessAt: iso(clan.roster.lastSuccessAt),
          lastSuccessProvenance: clan.roster.lastSuccessProvenance
            ? publicProvenance(clan.roster.lastSuccessProvenance)
            : null,
        }
      : null,
    members: clan.members.map((member) => ({ ...member, joinDate: member.joinDate.toISOString() })),
  })
}

function timestamp(value: Date | null | undefined): number {
  return value?.getTime() ?? 0
}

function stale(value: Date | null | undefined, now: number): boolean {
  return !value || now - value.getTime() > CLAN_TTL_MS
}

async function requestClanRefresh(
  ctx: Context,
  input: ClanRefreshInputContract,
  discordUserId?: string,
  now = Date.now(),
): Promise<ClanRefreshResponseContract> {
  const stored = await ctx.clanRepo.getById(input.id)
  const clan = await mapClan(ctx.clanRepo, input.id)
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
    const active = await ctx.refreshOperations.findActiveInteractiveClanRefresh(dedupeKey)
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

    let actor: Parameters<Context['requestAdmission']['admitActor']>[0]
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

    const reserved = await ctx.refreshOperations.reserveInteractiveClanRefresh({
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
      await ctx.refreshOperations.rejectInteractiveRefresh(
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
      (await ctx.refreshOperations.activateInteractiveRefresh(reserved.operationId, reserved.reservationToken)) ===
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
      .query(({ ctx, input }) => mapClan(ctx.clanRepo, input.id)),
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

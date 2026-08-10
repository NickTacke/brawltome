import {
  type DesktopRankedLookupContract,
  desktopRankedLookupInputSchema,
  parseDesktopRankedLookupOutput,
} from '@brawltome/contracts'
import type { PlayerReferenceQueries, RankedPlayerQueries } from '@brawltome/player'
import type { InteractiveRefreshOperations } from '@brawltome/refresh-operations'
import type { ActorAdmission } from '@brawltome/request-admission'
import { Hono } from 'hono'
import { requestInteractivePlayerRefresh } from '../interactive-player-refresh'
import { mapPlayerRankedProfile } from '../mappers/player-ranked.mapper'

const maxConcurrentDesktopLookups = 32

const temporarilyUnavailable = {
  outcome: 'temporarilyUnavailable' as const,
  retry: { kind: 'after' as const, afterSeconds: 30 },
}

interface DesktopRankedRouteDependencies {
  playerReferences: Pick<PlayerReferenceQueries, 'byId'>
  rankedPlayers: Pick<RankedPlayerQueries, 'byId'>
  refreshOperations: InteractiveRefreshOperations
  requestAdmission: ActorAdmission
}

function timestamp(value: Date | null | undefined): number {
  return value?.getTime() ?? 0
}

function clientIp(headers: Headers): string {
  return headers.get('x-client-ip') ?? '0.0.0.0'
}

export function createDesktopRankedRoutes(dependencies: DesktopRankedRouteDependencies): Hono {
  const routes = new Hono()
  let concurrentLookups = 0

  routes.use('/opponent/*', async (context, next) => {
    if (concurrentLookups >= maxConcurrentDesktopLookups) {
      return context.json({ error: 'too_many_concurrent_lookups' }, 429)
    }
    concurrentLookups++
    try {
      await next()
    } finally {
      concurrentLookups--
    }
  })

  routes.get('/opponent/:brawlhallaId', async (context) => {
    const input = desktopRankedLookupInputSchema.safeParse({
      brawlhallaId: Number(context.req.param('brawlhallaId')),
    })
    if (!input.success) return context.json({ error: 'invalid_brawlhalla_id' }, 400)

    const [playerResult, rankedResult] = await Promise.allSettled([
      dependencies.playerReferences.byId(input.data.brawlhallaId),
      dependencies.rankedPlayers.byId(input.data.brawlhallaId),
    ])
    const player = playerResult.status === 'fulfilled' ? playerResult.value : null
    const rankedProfile = rankedResult.status === 'fulfilled' ? rankedResult.value : null
    let ranked: ReturnType<typeof mapPlayerRankedProfile> = null
    let rankedReadFailed = rankedResult.status === 'rejected'
    try {
      ranked = mapPlayerRankedProfile(rankedProfile)
    } catch {
      rankedReadFailed = true
    }

    const fresh = rankedProfile?.freshness === 'fresh'
    const refresh = rankedReadFailed
      ? temporarilyUnavailable
      : fresh
        ? ({ outcome: 'notNeeded', retry: { kind: 'none' } } as const)
        : await requestInteractivePlayerRefresh({
            brawlhallaId: input.data.brawlhallaId,
            dedupeKey: `desktop-player:${input.data.brawlhallaId}:ranked:${timestamp(rankedProfile?.lastSuccessAt)}`,
            staleSections: ['ranked'],
            provenance: { source: 'desktop-api' },
            refreshOperations: dependencies.refreshOperations,
            requestAdmission: dependencies.requestAdmission,
            resolveActor: () => ({ kind: 'desktop', ip: clientIp(context.req.raw.headers) }),
          })

    const response: DesktopRankedLookupContract = parseDesktopRankedLookupOutput({
      player,
      ranked,
      refresh,
    })
    return context.json(response)
  })

  return routes
}

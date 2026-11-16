import type { RefreshOutcomeContract } from '@brawltome/contracts'
import type { PlayerRefreshReservations } from '@brawltome/player'
import type { PostgresRequestAdmission } from '@brawltome/request-admission'
import type { Telemetry } from '@brawltome/telemetry'
import { requestInteractivePlayerRefresh } from '../interactive-player-refresh'
import { sourceBudgetOpen } from '../player-name-verification'

// desktop refreshes stop at this share of the V0 window, so the rest stays for people on the site
export const opponentRefreshMaxUsageRatio = 0.75

export type DesktopRefreshState = { state: 'requested' | 'limited' | 'unavailable'; retryAfterSeconds: number }

export type DesktopRefresher = {
  // false when V0 usage is at or over the ratio, and when the usage can't be read
  isBudgetOpen(maxUsageRatio: number): Promise<boolean>
  request(input: { brawlhallaId: number; lastSuccessAt: Date | null; clientIp: string }): Promise<DesktopRefreshState>
}

type DesktopRefresherDependencies = {
  playerRefreshReservations: PlayerRefreshReservations
  requestAdmission: Pick<
    PostgresRequestAdmission,
    'admitActor' | 'admitActorOnce' | 'hasActorReservation' | 'inspectCurrentUsage'
  >
  telemetry: Pick<Telemetry, 'metrics' | 'logger'>
}

const unavailable: DesktopRefreshState = { state: 'unavailable', retryAfterSeconds: 30 }

function refreshStateOf(refresh: RefreshOutcomeContract): DesktopRefreshState {
  if (refresh.outcome === 'accepted' || refresh.outcome === 'alreadyRefreshing') {
    return { state: 'requested', retryAfterSeconds: 2 }
  }

  if (refresh.outcome === 'rateLimited') return { state: 'limited', retryAfterSeconds: refresh.retry.afterSeconds }

  return unavailable
}

// the key the 0.1.4 overlay route builds, so a lookup from either app joins the same refresh
function dedupeKeyOf(brawlhallaId: number, lastSuccessAt: Date | null): string {
  const lastSuccessMs = lastSuccessAt?.getTime() ?? 0

  return `desktop-player:${brawlhallaId}:ranked:${lastSuccessMs}`
}

export function createDesktopRefresher(dependencies: DesktopRefresherDependencies): DesktopRefresher {
  const { playerRefreshReservations, requestAdmission, telemetry } = dependencies

  async function isBudgetOpen(maxUsageRatio: number): Promise<boolean> {
    try {
      const usage = await requestAdmission.inspectCurrentUsage()
      const v0Usage = usage.domains.find(({ domain }) => domain === 'brawlhalla-v0')

      if (!v0Usage) return false

      return sourceBudgetOpen(v0Usage, maxUsageRatio)
    } catch (error) {
      telemetry.logger.error('desktop.refresh_budget.failed', error)

      return false
    }
  }

  async function request(input: Parameters<DesktopRefresher['request']>[0]): Promise<DesktopRefreshState> {
    const refresh = await requestInteractivePlayerRefresh({
      brawlhallaId: input.brawlhallaId,
      dedupeKey: dedupeKeyOf(input.brawlhallaId, input.lastSuccessAt),
      staleSections: ['ranked'],
      provenance: { source: 'desktop-api' },
      playerRefreshReservations,
      requestAdmission,
      resolveActor: () => ({ kind: 'desktop', ip: input.clientIp }),
      onError: (error) => telemetry.logger.error('desktop.refresh.failed', error),
    })

    telemetry.metrics.add('refresh_requests_total', 1, {
      kind: 'player',
      outcome: refresh.outcome,
      source: 'desktop-api',
    })

    return refreshStateOf(refresh)
  }

  return { isBudgetOpen, request }
}

import type { RefreshOutcomeContract } from '@brawltome/contracts'
import type { InteractiveRefreshOperations } from '@brawltome/refresh-operations'
import type { ActorAdmission, RefreshActor } from '@brawltome/request-admission'

const temporarilyUnavailable = {
  outcome: 'temporarilyUnavailable' as const,
  retry: { kind: 'after' as const, afterSeconds: 30 },
}

type ActorResolution = RefreshActor | RefreshOutcomeContract

interface InteractivePlayerRefreshRequest {
  brawlhallaId: number
  dedupeKey: string
  staleSections: ('ranked' | 'stats')[]
  provenance: { source: string; requestedBy?: string }
  refreshOperations: InteractiveRefreshOperations
  requestAdmission: ActorAdmission
  resolveActor: () => Promise<ActorResolution> | ActorResolution
  onError?: (error: unknown) => void
}

function poll(operationId: string): RefreshOutcomeContract {
  return {
    outcome: 'alreadyRefreshing',
    operationId,
    retry: { kind: 'poll', afterSeconds: 2 },
  }
}

export async function requestInteractivePlayerRefresh(
  request: InteractivePlayerRefreshRequest,
): Promise<RefreshOutcomeContract> {
  try {
    const active = await request.refreshOperations.findActiveInteractivePlayerRefresh(
      request.dedupeKey,
      request.brawlhallaId,
    )
    if (active) {
      if (active.awaitingAdmission) {
        if (await request.requestAdmission.hasActorReservation(active.operationId)) {
          await request.refreshOperations.activateAdmittedInteractiveRefresh(active.operationId)
        } else if (active.reservationExpired) {
          await request.refreshOperations.rejectExpiredInteractiveRefresh(active.operationId)
        } else {
          return poll(active.operationId)
        }
      }
      if (!active.reservationExpired || (await request.requestAdmission.hasActorReservation(active.operationId))) {
        return poll(active.operationId)
      }
    }

    const actor = await request.resolveActor()
    if ('outcome' in actor) return actor

    const reserved = await request.refreshOperations.reserveInteractivePlayerRefresh({
      dedupeKey: request.dedupeKey,
      operationKey: request.dedupeKey,
      brawlhallaId: request.brawlhallaId,
      staleSections: request.staleSections,
      provenance: request.provenance,
      reservationTtlSeconds: 30,
    })
    if (reserved.outcome === 'already-active') return poll(reserved.operationId)

    const admission = await request.requestAdmission.admitActor(actor, reserved.operationId)
    if (admission.outcome === 'rate-limited') {
      await request.refreshOperations.rejectInteractiveRefresh(
        reserved.operationId,
        reserved.reservationToken,
        'actor_rate_limited',
      )
      return {
        outcome: 'rateLimited',
        retry: { kind: 'after', afterSeconds: admission.retryAfterSeconds },
      }
    }

    const activated = await request.refreshOperations.activateInteractiveRefresh(
      reserved.operationId,
      reserved.reservationToken,
    )
    if (activated === 'lease-lost') return temporarilyUnavailable
    return {
      outcome: 'accepted',
      operationId: reserved.operationId,
      retry: { kind: 'poll', afterSeconds: 2 },
    }
  } catch (error) {
    request.onError?.(error)
    return temporarilyUnavailable
  }
}

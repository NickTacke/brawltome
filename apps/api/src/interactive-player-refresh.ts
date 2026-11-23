import type { RefreshOutcomeContract } from '@brawltome/contracts'
import type { PlayerRefreshReservations } from '@brawltome/player'
import type { ActorAdmission, AdmissionActor } from '@brawltome/request-admission'

const temporarilyUnavailable = {
  outcome: 'temporarilyUnavailable' as const,
  retry: { kind: 'after' as const, afterSeconds: 30 },
}

// another refresh of the player is running without one of the sections asked for; it ends in seconds
const otherRefreshRunning = {
  outcome: 'temporarilyUnavailable' as const,
  retry: { kind: 'after' as const, afterSeconds: 2 },
}

type ActorResolution = AdmissionActor | RefreshOutcomeContract

interface InteractivePlayerRefreshRequest {
  brawlhallaId: number
  dedupeKey: string
  staleSections: ('ranked' | 'stats')[]
  provenance: { source: string; requestedBy?: string }
  playerRefreshReservations: PlayerRefreshReservations
  requestAdmission: ActorAdmission
  resolveActor: () => Promise<ActorResolution> | ActorResolution
  onError?: (error: unknown) => void
}

type ActivePlayerRefresh = NonNullable<
  Awaited<ReturnType<PlayerRefreshReservations['findActiveInteractivePlayerRefresh']>>
>

function poll(operationId: string): RefreshOutcomeContract {
  return {
    outcome: 'alreadyRefreshing',
    operationId,
    retry: { kind: 'poll', afterSeconds: 2 },
  }
}

function rateLimited(retryAfterSeconds: number): RefreshOutcomeContract {
  return { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: retryAfterSeconds } }
}

// false only for an expired reservation nobody was charged for: it's rejected, so this request can make its own
async function isStillActive(request: InteractivePlayerRefreshRequest, active: ActivePlayerRefresh): Promise<boolean> {
  const reservations = request.playerRefreshReservations

  if (!active.awaitingAdmission) return true

  if (await request.requestAdmission.hasActorReservation(active.operationId)) {
    await reservations.activateAdmittedInteractivePlayerRefresh(active.operationId)

    return true
  }

  if (!active.reservationExpired) return true

  await reservations.rejectExpiredInteractivePlayerRefresh(active.operationId)

  return false
}

// waiting on a refresh changes nothing, so it needs no verification; anything that would change it does
async function answerWithoutChange(request: InteractivePlayerRefreshRequest): Promise<RefreshOutcomeContract | null> {
  const active = await request.playerRefreshReservations.findActiveInteractivePlayerRefresh(
    request.dedupeKey,
    request.brawlhallaId,
  )

  if (!active || !(await isStillActive(request, active))) return null

  const fit = await request.playerRefreshReservations.inspectVisitorFit(request.brawlhallaId, request.staleSections)

  if (fit === 'attach') return poll(active.operationId)

  if (fit === 'wait-for-running') return otherRefreshRunning

  return null
}

// the refresh holding the player becomes this visitor's, so they're admitted as if it were their own
async function takeOver(
  request: InteractivePlayerRefreshRequest,
  actor: AdmissionActor,
  operationId: string,
): Promise<RefreshOutcomeContract> {
  const admission = await request.requestAdmission.admitActor(actor, `${request.dedupeKey}:takeover:${operationId}`)

  if (admission.outcome === 'rate-limited') return rateLimited(admission.retryAfterSeconds)

  const takeover = await request.playerRefreshReservations.takeOverPlayerRefresh(
    request.brawlhallaId,
    request.staleSections,
  )

  // none: it ended in between, so asking again reserves a refresh of the visitor's own
  if (takeover.outcome !== 'attached') return otherRefreshRunning

  return poll(takeover.operationId)
}

async function reserveOwnRefresh(
  request: InteractivePlayerRefreshRequest,
  actor: AdmissionActor,
): Promise<RefreshOutcomeContract> {
  const reservations = request.playerRefreshReservations

  const reserved = await reservations.reserveInteractivePlayerRefresh({
    dedupeKey: request.dedupeKey,
    operationKey: request.dedupeKey,
    brawlhallaId: request.brawlhallaId,
    staleSections: request.staleSections,
    provenance: request.provenance,
    reservationTtlSeconds: 30,
  })

  if (reserved.outcome === 'already-active') return takeOver(request, actor, reserved.operationId)

  const admission = await request.requestAdmission.admitActor(actor, reserved.operationId)

  if (admission.outcome === 'rate-limited') {
    await reservations.rejectInteractivePlayerRefresh(
      reserved.operationId,
      reserved.reservationToken,
      'actor_rate_limited',
    )

    return rateLimited(admission.retryAfterSeconds)
  }

  const activated = await reservations.activateInteractivePlayerRefresh(reserved.operationId, reserved.reservationToken)

  if (activated === 'lease-lost') return temporarilyUnavailable

  return { outcome: 'accepted', operationId: reserved.operationId, retry: { kind: 'poll', afterSeconds: 2 } }
}

/**
 * Asks for a refresh of the player's stale sections. A visitor waits on a refresh already holding the player only
 * when it covers their sections; one that doesn't is taken over, once they pass verification and admission, or they
 * ask again after it ends.
 */
export async function requestInteractivePlayerRefresh(
  request: InteractivePlayerRefreshRequest,
): Promise<RefreshOutcomeContract> {
  try {
    const unchanged = await answerWithoutChange(request)

    if (unchanged) return unchanged

    const actor = await request.resolveActor()

    if ('outcome' in actor) return actor

    return await reserveOwnRefresh(request, actor)
  } catch (error) {
    request.onError?.(error)

    return temporarilyUnavailable
  }
}

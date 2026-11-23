import type { RefreshOutcomeContract } from '@brawltome/contracts'
import type { PlayerRefreshReservations } from '@brawltome/player'
import type { ActorAdmission, AdmissionActor } from '@brawltome/request-admission'

const temporarilyUnavailable = {
  outcome: 'temporarilyUnavailable' as const,
  retry: { kind: 'after' as const, afterSeconds: 30 },
}

// another refresh of the player is running, or being admitted, without one of the sections asked for
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

function findActive(request: InteractivePlayerRefreshRequest) {
  return request.playerRefreshReservations.findActiveInteractivePlayerRefresh(
    request.dedupeKey,
    request.brawlhallaId,
    request.staleSections,
  )
}

// a refresh that covers the visitor, or one they can't change yet, is answered as it is: that needs no verification
function answerAsItIs(active: ActivePlayerRefresh): RefreshOutcomeContract | null {
  if (active.fit === 'attach') return poll(active.operationId)

  if (active.fit === 'ask-again') return otherRefreshRunning

  return null
}

async function answerWithoutChange(request: InteractivePlayerRefreshRequest): Promise<RefreshOutcomeContract | null> {
  const active = await findActive(request)

  if (!active || !(await isStillActive(request, active))) return null

  return answerAsItIs(active)
}

// a queued refresh missing the visitor's sections becomes theirs, so they're admitted as if it were their own
async function takeOver(
  request: InteractivePlayerRefreshRequest,
  actor: AdmissionActor,
): Promise<RefreshOutcomeContract> {
  const active = await findActive(request)

  // it ended in between, so asking again reserves a refresh of the visitor's own
  if (!active) return otherRefreshRunning

  const unchanged = answerAsItIs(active)

  if (unchanged) return unchanged

  const reservationKey = `${request.dedupeKey}:takeover:${active.operationId}`
  const admission = await request.requestAdmission.admitActor(actor, reservationKey)

  if (admission.outcome === 'rate-limited') return rateLimited(admission.retryAfterSeconds)

  const takeover = await request.playerRefreshReservations.takeOverPlayerRefresh(
    request.brawlhallaId,
    request.staleSections,
  )

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

  if (reserved.outcome === 'already-active') return takeOver(request, actor)

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
 * Asks for a refresh of the player's stale sections. A visitor waits on a refresh already holding the player when it
 * covers their sections. A queued one that doesn't is taken over once they pass verification and admission; one that
 * is running or being admitted for someone else has them ask again shortly.
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

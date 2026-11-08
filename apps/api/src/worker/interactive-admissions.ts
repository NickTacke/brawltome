import type { RefreshOperationWorker } from '@brawltome/refresh-operations'
import type { ActorAdmission } from '@brawltome/request-admission'

// activates player and clan refreshes whose actor reservation has come through, across both owners' kinds
export async function reconcileInteractiveAdmissions(
  operations: RefreshOperationWorker,
  actorAdmission: ActorAdmission,
): Promise<number> {
  let activated = 0

  for (const operationId of await operations.listAwaitingInteractiveRefreshes()) {
    if (!(await actorAdmission.hasActorReservation(operationId))) continue

    if ((await operations.activateAdmittedInteractiveRefresh(operationId)) === 'transitioned') activated++
  }

  return activated
}

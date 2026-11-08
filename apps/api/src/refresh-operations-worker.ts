import {
  type AdmissionConfig,
  createJobRegistry,
  type JobDefinition,
  type RefreshOperationWorker,
  type RetryBackoff,
  runOneJob,
} from '@brawltome/refresh-operations'
import type { ActorAdmission, SourceAdmission } from '@brawltome/request-admission'
import type { Telemetry } from '@brawltome/telemetry'

type RunOneRefreshOperationOptions = {
  leaseMs: number
  retryDelayMs: number
  retryBackoff?: RetryBackoff
  sourceUnavailableRetryMs?: number
  admission: AdmissionConfig
  renewEveryMs?: number
  sourceAdmission?: SourceAdmission
  telemetry?: Telemetry
  // jobs that live in their owning module
  movedJobs?: readonly JobDefinition<unknown>[]
}

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

export function createJobsFromOptions(options: RunOneRefreshOperationOptions): JobDefinition<unknown>[] {
  return [...(options.movedJobs ?? [])]
}

export function runOneRefreshOperation(
  operations: RefreshOperationWorker,
  workerId: string,
  options: RunOneRefreshOperationOptions,
): Promise<boolean> {
  return runOneJob(operations, workerId, createJobRegistry(createJobsFromOptions(options)), options)
}

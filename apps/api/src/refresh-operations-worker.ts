import {
  type AdmissionConfig,
  createJobRegistry,
  type JobDefinition,
  type RefreshOperationWorker,
  type RetryBackoff,
  runOneJob,
} from '@brawltome/refresh-operations'
import type { SourceAdmission } from '@brawltome/request-admission'
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

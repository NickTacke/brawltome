import type { AttemptOutcome, JobDefinition, QueueWorker } from './jobs/job-definition'
import { type RunOneJobOptions, runClaimedJob } from './jobs/run-one-job'
import type { AdmissionConfig } from './model'

const testWorkerId = 'test-worker'

const testAdmission: AdmissionConfig = {
  totalConcurrency: 12,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 2,
    leaderboard: 2,
    'global-statistics': 2,
    projection: 2,
    maintenance: 2,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
}

/** Claims the next operation of the job's kind and runs that job on it, in place of the worker's dispatch. */
export async function runJobOnce<Payload>(
  queue: QueueWorker,
  job: JobDefinition<Payload>,
  options: Partial<RunOneJobOptions> = {},
): Promise<AttemptOutcome> {
  const resolved: RunOneJobOptions = { leaseMs: 30_000, retryDelayMs: 1_000, admission: testAdmission, ...options }
  const claimed = await queue.claim(testWorkerId, resolved.leaseMs, resolved.admission, job.kind)

  if (!claimed) throw new Error(`run job once for kind ${job.kind}: no operation was due`)

  return runClaimedJob(queue, claimed, job as JobDefinition<unknown>, resolved)
}

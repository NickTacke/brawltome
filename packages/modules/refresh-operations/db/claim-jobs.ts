import type { JobContract, JobDefinition } from '../jobs/job-definition'

export type ClaimJob = JobContract<unknown> & Pick<JobDefinition<unknown>, 'effectState' | 'claimLockKey'>

export type ClaimJobs = ReadonlyMap<string, ClaimJob>

export function createClaimJobs(jobs: readonly ClaimJob[]): ClaimJobs {
  return new Map(jobs.map((job) => [job.kind, job]))
}

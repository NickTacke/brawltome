import type { JobDefinition } from '../jobs/job-definition'
import type { OperationLease } from '../model'

export type EffectStateEntry = Pick<JobDefinition<unknown>, 'effectState' | 'claimLockKey'>

export type EffectStates = Readonly<Partial<Record<OperationLease['kind'], EffectStateEntry>>>

// every job states how claim reads its effect, so a kind in the list needs nothing more to be claimable
export function createEffectStates(jobs: readonly JobDefinition<unknown>[]): EffectStates {
  return Object.fromEntries(jobs.map((job) => [job.kind, job]))
}

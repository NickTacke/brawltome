import type { WorkClass } from '../model'
import type { JobContract } from './job-definition'

/** Throws unless this job can run this payload in this work class. Every write path and claim go through here. */
export function assertValidJobInput(job: JobContract<unknown>, workClass: WorkClass, payload: unknown): void {
  if (!job.workClasses.includes(workClass)) {
    throw new Error(`validate job ${job.kind}: work class ${workClass} is not allowed`)
  }

  job.parsePayload(payload, workClass)
}

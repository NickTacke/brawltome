import { workClasses } from '../model'
import type { JobDefinition } from './job-definition'

export type JobRegistry = {
  get(kind: string): JobDefinition<unknown>
}

function assertKnownWorkClasses(job: JobDefinition<unknown>): void {
  const known: readonly string[] = workClasses

  for (const workClass of job.workClasses) {
    if (!known.includes(workClass)) throw new Error(`register job ${job.kind}: unknown work class ${workClass}`)
  }
}

export function createJobRegistry(jobs: readonly JobDefinition<unknown>[]): JobRegistry {
  const jobsByKind = new Map<string, JobDefinition<unknown>>()

  for (const job of jobs) {
    assertKnownWorkClasses(job)

    if (jobsByKind.has(job.kind)) throw new Error(`register job ${job.kind}: kind is already registered`)

    jobsByKind.set(job.kind, job)
  }

  return {
    get(kind) {
      const job = jobsByKind.get(kind)

      if (!job) throw new Error(`find job for kind ${kind}: no job is registered`)

      return job
    },
  }
}

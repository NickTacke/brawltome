import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiClient } from './api-client'
import type { ProcessPool } from './process-pool'

export type WorkerDeps = {
  api: ApiClient
  pool: ProcessPool
  // where claimed replays are written for bh-native to read
  workDir: string
  renewEveryMs: number
}

/** Claims one replay, plays it and sends the answer; 'idle' when the api had nothing to do. */
export async function runOnce(deps: WorkerDeps): Promise<'idle' | 'done'> {
  // with no bh-native running every claim would fail its job, so nothing is claimed until one is back
  if (!deps.pool.isReady()) return 'idle'

  const job = await deps.api.claim(deps.pool.report())

  if (!job) return 'idle'

  // bh-native names its answer after the file, so the job id makes it unique
  const path = join(deps.workDir, `${job.jobId}.replay`)

  const renewal = setInterval(() => {
    deps.api.renew(job.jobId, job.leaseToken).catch((error: unknown) => console.error(`renew job ${job.jobId}:`, error))
  }, deps.renewEveryMs)

  try {
    writeFileSync(path, job.bytes)

    const answer = await deps.pool.play(path)

    if (answer.kind === 'line') await deps.api.result(job.jobId, job.leaseToken, answer.raw)
    else await deps.api.failure(job.jobId, job.leaseToken, answer.code, answer.message)
  } finally {
    clearInterval(renewal)
    rmSync(path, { force: true })
  }

  return 'done'
}

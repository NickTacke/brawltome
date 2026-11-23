import type { Database } from '@brawltome/foundation'
import { type AttemptOutcome, JobLeaseLostError, type JobTools, type Lease } from '@brawltome/queue'
import { recordFailure } from '../db/record-failure'
import type { BrawltoolsClient } from '../source/brawltools-client'
import { isBrawltoolsRateLimited, isBrawltoolsUnavailable } from './brawltools-failures'
import type { EsportsPlayerPayload } from './player-payload'

export type EsportsJobDependencies = {
  database: Database
  // the brawltools client, with every call spending one call of the source budget first
  createClient(admit: () => Promise<void>): BrawltoolsClient
}

// a rate limit puts the job back to run soon, and a lost lease leaves the player to the run that took over, so
// neither is a failed refresh
export function isFailedRefresh(error: unknown, leaseLost: AbortSignal): boolean {
  const isLeaseLost = leaseLost.aborted || error instanceof JobLeaseLostError

  return !isBrawltoolsRateLimited(error) && !isLeaseLost
}

/**
 * Runs the work of one esports job and completes it. Any failed refresh is counted, so the read waits a day before
 * asking again instead of asking on every view. When brawltools is down the job then completes all the same, where
 * a retry would ask within minutes; any other error still fails the job, so it shows up in the dead letters.
 */
export async function runEsportsJob(
  dependencies: EsportsJobDependencies,
  lease: Lease<EsportsPlayerPayload>,
  tools: JobTools,
  work: (client: BrawltoolsClient) => Promise<void>,
): Promise<AttemptOutcome> {
  const admitSource = tools.createSourceAdmitter('esports')
  const client = dependencies.createClient(() => admitSource('brawltools'))

  try {
    await work(client)
  } catch (error) {
    if (!isFailedRefresh(error, tools.signal)) throw error

    await recordFailure(dependencies.database, lease.payload.brawlhallaId, new Date())

    if (!isBrawltoolsUnavailable(error)) throw error
  }

  const transition = await tools.queue.complete(lease)

  return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

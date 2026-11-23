import type { Database } from '@brawltome/foundation'
import type { AttemptOutcome, JobTools, Lease } from '@brawltome/queue'
import { recordFailure } from '../db/record-failure'
import type { BrawltoolsClient } from '../source/brawltools-client'
import { isBrawltoolsUnavailable } from './brawltools-failures'
import type { EsportsPlayerPayload } from './player-payload'

export type EsportsJobDependencies = {
  database: Database
  // the brawltools client, with every call spending one call of the source budget first
  createClient(admit: () => Promise<void>): BrawltoolsClient
}

/**
 * Runs the work of one esports job and completes it. When brawltools is down the job counts a failed refresh and
 * completes all the same: the read then waits a day before asking again, where a retry would ask within minutes.
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
    if (!isBrawltoolsUnavailable(error)) throw error

    await recordFailure(dependencies.database, lease.payload.brawlhallaId, new Date())
  }

  const transition = await tools.queue.complete(lease)

  return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { acceptOperation, type JobContract } from '@brawltome/queue'
import { esportsRefreshContract } from './esports-refresh-contract'
import { esportsSetsBackfillContract } from './esports-sets-backfill-contract'
import type { EsportsPlayerPayload } from './player-payload'

// the dedupe key is also the resource key, so a player has at most one of each kind active, and a request while one
// is pending or running is that one
async function enqueuePlayerJob(
  database: Database,
  job: JobContract<EsportsPlayerPayload>,
  brawlhallaId: number,
  source: string,
): Promise<void> {
  const key = `${job.kind}:${brawlhallaId}`

  await acceptOperation(database, {
    job,
    dedupeKey: key,
    operationKey: `${key}:${randomUUID()}`,
    resourceKey: key,
    workClass: 'maintenance',
    payload: { brawlhallaId },
    provenance: { source },
  })
}

/** Asks for a refresh of a player's esports results, unless one is pending or running already. */
export function enqueueEsportsRefresh(database: Database, brawlhallaId: number): Promise<void> {
  return enqueuePlayerJob(database, esportsRefreshContract, brawlhallaId, 'esports-read')
}

/** Asks for the sets of a player's events that have none yet, unless a backfill is pending or running already. */
export function enqueueEsportsSetsBackfill(database: Database, brawlhallaId: number): Promise<void> {
  return enqueuePlayerJob(database, esportsSetsBackfillContract, brawlhallaId, 'esports-refresh')
}

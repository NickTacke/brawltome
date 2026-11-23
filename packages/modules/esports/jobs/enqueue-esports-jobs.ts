import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { acceptOperation, countActive, type JobContract } from '@brawltome/queue'
import { esportsRefreshContract } from './esports-refresh-contract'
import { esportsSetsBackfillContract } from './esports-sets-backfill-contract'
import type { EsportsPlayerPayload } from './player-payload'

// maintenance work runs in order, so a flood of refreshes would hold up retention and the other jobs behind it; past
// this many waiting a view skips asking, and a later view asks once the queue has drained
const maxActiveRefreshes = 500

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

/** Asks for a refresh of a player's esports results, unless one is active already or too many are. */
export async function enqueueEsportsRefresh(database: Database, brawlhallaId: number): Promise<void> {
  const activeRefreshes = await countActive(database, {
    kind: esportsRefreshContract.kind,
    workClass: 'maintenance',
    payloadEquals: {},
  })

  if (activeRefreshes >= maxActiveRefreshes) return

  await enqueuePlayerJob(database, esportsRefreshContract, brawlhallaId, 'esports-read')
}

/** Asks for the sets of a player's events that have none yet, unless a backfill is pending or running already. */
export function enqueueEsportsSetsBackfill(database: Database, brawlhallaId: number): Promise<void> {
  return enqueuePlayerJob(database, esportsSetsBackfillContract, brawlhallaId, 'esports-refresh')
}

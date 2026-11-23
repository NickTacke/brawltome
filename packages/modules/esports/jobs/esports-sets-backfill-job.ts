import type { Database } from '@brawltome/foundation'
import { defineJob, type JobDefinition } from '@brawltome/queue'
import { listEventsMissingSets } from '../db/list-events-missing-sets'
import { readStoredEsports } from '../db/read-stored-esports'
import { saveEventSets } from '../db/save-event-sets'
import { isSideModeEvent } from '../domain'
import type { BrawltoolsClient } from '../source/brawltools-client'
import { decideBrawltoolsFailure } from './brawltools-failures'
import { type EsportsSetsBackfillPayload, esportsSetsBackfillContract } from './esports-sets-backfill-contract'
import { type EsportsJobDependencies, runEsportsJob } from './run-esports-job'

export type EsportsSetsBackfillJobDependencies = EsportsJobDependencies

async function listEventsToFetch(database: Database, brawlhallaId: number) {
  const missing = await listEventsMissingSets(database, brawlhallaId, new Date())

  // the page leaves side mode events out, so their sets would never show
  return missing.filter((event) => !isSideModeEvent(event.tournamentName))
}

// each event is saved as soon as it is fetched, so a backfill cut short keeps what it got and a rerun goes on from there
async function backfillSets(
  dependencies: EsportsSetsBackfillJobDependencies,
  client: BrawltoolsClient,
  brawlhallaId: number,
  leaseLost: AbortSignal,
): Promise<void> {
  const { row } = await readStoredEsports(dependencies.database, brawlhallaId)
  const brawltoolsPlayerId = row?.brawltoolsPlayerId

  if (row?.link !== 'linked' || !brawltoolsPlayerId) return

  for (const { tournamentId } of await listEventsToFetch(dependencies.database, brawlhallaId)) {
    // a pro's first backfill is about a hundred calls; a lost lease means another run may take over, so stop spending
    if (leaseLost.aborted) return

    const sets = await client.matches(brawltoolsPlayerId, tournamentId)

    await saveEventSets(dependencies.database, brawlhallaId, tournamentId, sets, new Date())
  }
}

/** Fetches the sets of every stored event of one player that has none yet, or only some from before it was final. */
export function createEsportsSetsBackfillJob(
  dependencies: EsportsSetsBackfillJobDependencies,
): JobDefinition<EsportsSetsBackfillPayload> {
  return defineJob<EsportsSetsBackfillPayload>({
    ...esportsSetsBackfillContract,
    failureCode: 'esports_sets_backfill_failed',
    run: (lease, tools) =>
      runEsportsJob(dependencies, lease, tools, (client) =>
        backfillSets(dependencies, client, lease.payload.brawlhallaId, tools.signal),
      ),
    decideFailure: decideBrawltoolsFailure,
  })
}

import type { Database } from '@brawltome/foundation'
import { defineJob, type JobDefinition } from '@brawltome/queue'
import { listEventsMissingSets } from '../db/list-events-missing-sets'
import { readEsportsPlayer } from '../db/read-stored-esports'
import { saveEventSets } from '../db/save-event-sets'
import { isSideModeEvent } from '../domain'
import type { BrawltoolsClient } from '../source/brawltools-client'
import { decideBrawltoolsFailure, isBrawltoolsRateLimited, isBrawltoolsUnavailable } from './brawltools-failures'
import { type EsportsSetsBackfillPayload, esportsSetsBackfillContract } from './esports-sets-backfill-contract'
import { type EsportsJobDependencies, runEsportsJob } from './run-esports-job'

export type EsportsSetsBackfillJobDependencies = EsportsJobDependencies

type EventToFetch = { brawlhallaId: number; brawltoolsPlayerId: number; tournamentId: string }

// this many events in a row finding brawltools down or not answering means it is down, not that one event is broken
const maxUnavailableInARow = 3

// a failed event is returned, not thrown, so the events after it are still fetched; a rate limit still stops the run
async function fetchEventSets(
  dependencies: EsportsSetsBackfillJobDependencies,
  client: BrawltoolsClient,
  event: EventToFetch,
): Promise<unknown> {
  try {
    const sets = await client.matches(event.brawltoolsPlayerId, event.tournamentId)

    await saveEventSets(dependencies.database, event.brawlhallaId, event.tournamentId, sets, new Date())

    return null
  } catch (error) {
    if (isBrawltoolsRateLimited(error)) throw error

    return error
  }
}

async function listEventsToFetch(database: Database, brawlhallaId: number) {
  const missing = await listEventsMissingSets(database, brawlhallaId, new Date())

  // the page leaves side mode events out, so their sets would never show
  return missing.filter((event) => !isSideModeEvent(event.tournamentName))
}

// each event is saved as soon as it is fetched, so a backfill cut short keeps what it got and a rerun goes on from
// there; a failed event is thrown once the rest are done, so the job counts one failed refresh for the run
async function backfillSets(
  dependencies: EsportsSetsBackfillJobDependencies,
  client: BrawltoolsClient,
  brawlhallaId: number,
  leaseLost: AbortSignal,
): Promise<void> {
  const row = await readEsportsPlayer(dependencies.database, brawlhallaId)
  const brawltoolsPlayerId = row?.brawltoolsPlayerId

  if (row?.link !== 'linked' || !brawltoolsPlayerId) return

  let lastFailure: unknown = null
  let unavailableInARow = 0

  for (const { tournamentId } of await listEventsToFetch(dependencies.database, brawlhallaId)) {
    // a pro's first backfill is about a hundred calls; a lost lease means another run may take over, and a run of
    // unavailable answers that brawltools is down, so either way stop spending
    if (leaseLost.aborted || unavailableInARow >= maxUnavailableInARow) break

    const failure = await fetchEventSets(dependencies, client, { brawlhallaId, brawltoolsPlayerId, tournamentId })

    // any other answer, a broken event's included, means brawltools is up, so the streak starts over
    unavailableInARow = isBrawltoolsUnavailable(failure) ? unavailableInARow + 1 : 0
    lastFailure = failure ?? lastFailure
  }

  if (lastFailure) throw lastFailure
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

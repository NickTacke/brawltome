import { defineJob, type JobDefinition } from '@brawltome/queue'
import { listEventsMissingSets } from '../db/list-events-missing-sets'
import { saveEventSets } from '../db/save-event-sets'
import { type RefreshInput, saveRefresh } from '../db/save-refresh'
import { buildKnownLegendKeys, highlightTournamentIds, type StoredPlacement, shapeEsportsProfile } from '../domain'
import type { BrawltoolsClient, GameMode } from '../source/brawltools-client'
import type { RawMatch, RawPlacement, RawPlayer } from '../source/raw-types'
import { decideBrawltoolsFailure } from './brawltools-failures'
import { type EsportsRefreshPayload, esportsRefreshContract } from './esports-refresh-contract'
import { type EsportsJobDependencies, runEsportsJob } from './run-esports-job'

export type EsportsRefreshJobDependencies = EsportsJobDependencies & {
  // asks for the sets of the player's other events, once the refresh has saved them
  enqueueBackfill(brawlhallaId: number): Promise<void>
}

type LinkedRefresh = RefreshInput & { player: RawPlayer }

const isLinked = (refresh: RefreshInput): refresh is LinkedRefresh => refresh.player !== null

function toStoredPlacement(mode: GameMode, raw: RawPlacement): StoredPlacement {
  const { tournament } = raw

  return {
    mode,
    tournamentId: tournament.id,
    tournamentName: tournament.tournamentName,
    isOfficial: tournament.isOfficial,
    isOnline: tournament.isOnline,
    startTime: new Date(tournament.startTime * 1000),
    placement: raw.placement,
  }
}

function notLinked(brawlhallaId: number, checkedAt: Date): RefreshInput {
  return {
    brawlhallaId,
    link: 'none',
    player: null,
    pr1v1: null,
    pr2v2: null,
    placements: [],
    eventLegends: [],
    checkedAt,
  }
}

// every call is made before anything is saved, so a failed refresh leaves the stored results as they were
async function fetchRefresh(client: BrawltoolsClient, brawlhallaId: number): Promise<RefreshInput> {
  const checkedAt = new Date()
  const player = await client.playerByBrawlhallaId(brawlhallaId)

  if (!player) return notLinked(brawlhallaId, checkedAt)

  const pr1v1 = await client.powerRanking(player.playerId, 1)
  const pr2v2 = await client.powerRanking(player.playerId, 2)
  const placements1v1 = await client.placements(player.playerId, 1)
  const placements2v2 = await client.placements(player.playerId, 2)
  const eventLegends = await client.eventLegends(player.playerId)

  const placements = [
    ...placements1v1.map((raw) => toStoredPlacement(1, raw)),
    ...placements2v2.map((raw) => toStoredPlacement(2, raw)),
  ]

  return { brawlhallaId, link: 'linked', player, pr1v1, pr2v2, placements, eventLegends, checkedAt }
}

// the highlight cards show the legend played, which comes from the sets, so their events are fetched right away;
// sets that are final and stored already are not asked for again
async function fetchHighlightSets(
  dependencies: EsportsRefreshJobDependencies,
  client: BrawltoolsClient,
  refresh: LinkedRefresh,
  legendKeys: ReadonlySet<string>,
): Promise<void> {
  const { brawlhallaId, pr1v1, pr2v2, placements } = refresh
  const stored = { pr1v1, pr2v2, placements, setsByTournament: new Map<string, RawMatch[]>() }
  const profile = shapeEsportsProfile(stored, legendKeys)

  if (!profile) return

  const missing = new Set(await listEventsMissingSets(dependencies.database, brawlhallaId, new Date()))
  const wanted = highlightTournamentIds(profile).filter((tournamentId) => missing.has(tournamentId))

  for (const tournamentId of wanted) {
    const sets = await client.matches(refresh.player.playerId, tournamentId)

    await saveEventSets(dependencies.database, brawlhallaId, tournamentId, sets, new Date())
  }
}

async function refreshPlayer(
  dependencies: EsportsRefreshJobDependencies,
  client: BrawltoolsClient,
  brawlhallaId: number,
  legendKeys: ReadonlySet<string>,
): Promise<void> {
  const refresh = await fetchRefresh(client, brawlhallaId)

  await saveRefresh(dependencies.database, refresh)

  if (!isLinked(refresh)) return

  await fetchHighlightSets(dependencies, client, refresh, legendKeys)
  await dependencies.enqueueBackfill(brawlhallaId)
}

/**
 * Refreshes one player's esports results from brawltools. A rerun is safe, since saveRefresh replaces what is
 * stored and saveEventSets upserts.
 */
export function createEsportsRefreshJob(
  dependencies: EsportsRefreshJobDependencies,
): JobDefinition<EsportsRefreshPayload> {
  const legendKeys = buildKnownLegendKeys()

  return defineJob<EsportsRefreshPayload>({
    ...esportsRefreshContract,
    failureCode: 'esports_refresh_failed',
    // saveRefresh is not safe for two refreshes of one player at once, so whoever enqueues this kind passes the
    // player as its resource key, which keeps one active per player
    run: (lease, tools) =>
      runEsportsJob(dependencies, lease, tools, (client) =>
        refreshPlayer(dependencies, client, lease.payload.brawlhallaId, legendKeys),
      ),
    decideFailure: decideBrawltoolsFailure,
  })
}

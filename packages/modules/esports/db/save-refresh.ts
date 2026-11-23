import type { Database } from '@brawltome/foundation'
import { eq } from 'drizzle-orm'
import type { StoredPlacement } from '../domain'
import type { RawLegendCount, RawPlayer, RawPr } from '../source/raw-types'
import { type EsportsLink, placements, players } from './tables'

export type RefreshInput = {
  brawlhallaId: number
  link: EsportsLink
  player: RawPlayer | null
  pr1v1: RawPr | null
  pr2v2: RawPr | null
  placements: StoredPlacement[]
  eventLegends: RawLegendCount[]
  checkedAt: Date
}

// a repeated event keeps its best finish, since the table has one row per player, mode and tournament
function bestPerEvent(candidates: StoredPlacement[]): StoredPlacement[] {
  const bestByEvent = new Map<string, StoredPlacement>()

  for (const candidate of candidates) {
    const eventKey = `${candidate.mode}:${candidate.tournamentId}`
    const best = bestByEvent.get(eventKey)

    if (!best || candidate.placement < best.placement) bestByEvent.set(eventKey, candidate)
  }

  return [...bestByEvent.values()]
}

// the table only accepts finishes from 1 up and one row per event, and one odd row from brawltools must not fail
// the whole refresh
function placementsToKeep(input: RefreshInput): StoredPlacement[] {
  if (input.link === 'none') return []

  const validPlacements = input.placements.filter((stored) => stored.placement >= 1)

  return bestPerEvent(validPlacements)
}

/**
 * Stores what a refresh learned about a player and replaces their placements, in one transaction. A success, so it
 * also clears the failure count. Event sets are left alone, they are saved per event.
 */
export async function saveRefresh(database: Database, input: RefreshInput): Promise<void> {
  const { brawlhallaId, link, player, pr1v1, pr2v2, eventLegends, checkedAt } = input

  const values = {
    brawltoolsPlayerId: player?.playerId ?? null,
    brawltoolsName: player?.name ?? null,
    link,
    powerRanking1v1: pr1v1,
    powerRanking2v2: pr2v2,
    eventLegends,
    checkedAt,
    lastSuccessAt: checkedAt,
    failureCount: 0,
  }

  const rows = placementsToKeep(input).map((stored) => ({ brawlhallaId, ...stored }))

  await database.db.transaction(async (transaction) => {
    await transaction
      .insert(players)
      .values({ brawlhallaId, ...values })
      .onConflictDoUpdate({ target: players.brawlhallaId, set: values })

    await transaction.delete(placements).where(eq(placements.brawlhallaId, brawlhallaId))

    if (rows.length === 0) return

    await transaction.insert(placements).values(rows)
  })
}

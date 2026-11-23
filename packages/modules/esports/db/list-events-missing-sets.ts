import type { Database } from '@brawltome/foundation'
import { and, eq, isNull, or, type SQL, sql } from 'drizzle-orm'
import { eventSets, placements } from './tables'

// sets of an event that started longer ago than this are final
const finalAfterDays = 7

/**
 * The player's tournament ids whose sets are worth fetching: events never fetched, and events fetched while they
 * were under 7 days old that are final now, since their sets may have been incomplete.
 */
export async function listEventsMissingSets(database: Database, brawlhallaId: number, now: Date): Promise<string[]> {
  const finalAt = sql`${placements.startTime} + make_interval(days => ${finalAfterDays})`
  const isFinalNow: SQL = sql`${finalAt} < ${now.toISOString()}::timestamptz`
  const wasFetchedBeforeFinal: SQL = sql`${eventSets.fetchedAt} < ${finalAt}`

  const rows = await database.db
    .selectDistinct({ tournamentId: placements.tournamentId })
    .from(placements)
    .leftJoin(
      eventSets,
      and(eq(eventSets.brawlhallaId, placements.brawlhallaId), eq(eventSets.tournamentId, placements.tournamentId)),
    )
    .where(
      and(
        eq(placements.brawlhallaId, brawlhallaId),
        or(isNull(eventSets.tournamentId), and(wasFetchedBeforeFinal, isFinalNow)),
      ),
    )
    .orderBy(placements.tournamentId)

  return rows.map((row) => row.tournamentId)
}

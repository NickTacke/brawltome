import type { Database } from '@brawltome/foundation'
import { eq } from 'drizzle-orm'
import type { StoredEsports, StoredPlacement } from '../domain'
import type { RawMatch } from '../source/raw-types'
import { eventSets, placements, players } from './tables'
import type { Transaction } from './transaction'

export type PlayerRow = typeof players.$inferSelect

// every read in the transaction sees the same snapshot, so a refresh that commits meanwhile shows up whole or not
// at all; it takes no locks, so it never waits on a writer
const readOnlySnapshot = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const

async function readPlayerRow(transaction: Transaction, brawlhallaId: number): Promise<PlayerRow | null> {
  const [row] = await transaction.select().from(players).where(eq(players.brawlhallaId, brawlhallaId))

  return row ?? null
}

async function readPlacements(transaction: Transaction, brawlhallaId: number): Promise<StoredPlacement[]> {
  const rows = await transaction
    .select()
    .from(placements)
    .where(eq(placements.brawlhallaId, brawlhallaId))
    .orderBy(placements.mode, placements.tournamentId)

  // the table's check keeps mode to 1 and 2
  return rows.map((row) => ({
    mode: row.mode === 2 ? 2 : 1,
    tournamentId: row.tournamentId,
    tournamentName: row.tournamentName,
    isOfficial: row.isOfficial,
    isOnline: row.isOnline,
    startTime: row.startTime,
    placement: row.placement,
  }))
}

async function readSetsByTournament(transaction: Transaction, brawlhallaId: number): Promise<Map<string, RawMatch[]>> {
  const rows = await transaction
    .select({ tournamentId: eventSets.tournamentId, sets: eventSets.sets })
    .from(eventSets)
    .where(eq(eventSets.brawlhallaId, brawlhallaId))

  return new Map(rows.map((row) => [row.tournamentId, row.sets]))
}

/** The player's row and everything stored for them, as the domain shapes it. A player never stored reads as empty. */
export async function readStoredEsports(
  database: Database,
  brawlhallaId: number,
): Promise<{ row: PlayerRow | null; stored: StoredEsports }> {
  return database.db.transaction(async (transaction) => {
    const row = await readPlayerRow(transaction, brawlhallaId)
    const storedPlacements = await readPlacements(transaction, brawlhallaId)
    const setsByTournament = await readSetsByTournament(transaction, brawlhallaId)

    const stored = {
      pr1v1: row?.powerRanking1v1 ?? null,
      pr2v2: row?.powerRanking2v2 ?? null,
      placements: storedPlacements,
      setsByTournament,
    }

    return { row, stored }
  }, readOnlySnapshot)
}

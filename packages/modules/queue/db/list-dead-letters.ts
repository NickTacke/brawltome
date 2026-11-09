import type { Database } from '@brawltome/foundation'
import { and, desc, eq, type SQL, sql } from 'drizzle-orm'
import type { DeadLetterPage, ListDeadLettersInput } from '../model'
import { deadLetterListColumns, toDeadLetterListItem } from './dead-letter-list-item'
import { deadLetterActions, operations } from './tables'

const defaultLimit = 50
const maximumLimit = 100

// pages run newest first, so the next page holds what sorts before the cursor's operation
function isBeforeCursor(database: Database, cursor: string): SQL {
  const cursorOperation = database.db
    .select({ completedAt: operations.completedAt, id: operations.id })
    .from(operations)
    .where(eq(operations.id, cursor))

  return sql`(${operations.completedAt}, ${operations.id}) < ${cursorOperation}`
}

export async function listDeadLetters(database: Database, input: ListDeadLettersInput = {}): Promise<DeadLetterPage> {
  const limit = input.limit ?? defaultLimit

  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new Error(`limit must be an integer between 1 and ${maximumLimit}`)
  }

  const isAfterPreviousPage = input.cursor ? isBeforeCursor(database, input.cursor) : undefined

  // one extra row tells whether another page follows
  const rows = await database.db
    .select(deadLetterListColumns)
    .from(operations)
    .leftJoin(deadLetterActions, eq(deadLetterActions.targetOperationId, operations.id))
    .where(and(eq(operations.status, 'dead_letter'), isAfterPreviousPage))
    .orderBy(desc(operations.completedAt), desc(operations.id))
    .limit(limit + 1)

  const pageRows = rows.slice(0, limit)
  const items = pageRows.map(toDeadLetterListItem)

  return {
    items,
    nextCursor: rows.length > limit ? (pageRows.at(-1)?.operationId ?? null) : null,
  }
}

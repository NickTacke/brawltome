import type { Database } from '@brawltome/foundation'

export async function listAwaitingInteractiveRefreshes(database: Database): Promise<string[]> {
  const client = database.sql

  const rows = await client<{ id: string }[]>`
    SELECT id FROM refresh_operations.operations
    WHERE kind IN ('interactive-player-refresh', 'clan-refresh') AND status = 'awaiting_admission'
    ORDER BY created_at, id
    LIMIT 100
  `

  return rows.map(({ id }) => id)
}

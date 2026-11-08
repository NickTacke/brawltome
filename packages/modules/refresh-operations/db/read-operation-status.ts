import type { Database } from '@brawltome/foundation'
import { eq } from 'drizzle-orm'
import { operations } from './tables'

export async function readOperationStatus(database: Database, operationId: string): Promise<string | null> {
  const [operation] = await database.db
    .select({ status: operations.status })
    .from(operations)
    .where(eq(operations.id, operationId))

  return operation?.status ?? null
}

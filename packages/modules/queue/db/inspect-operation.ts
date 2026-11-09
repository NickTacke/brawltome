import type { Database } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import type postgres from 'postgres'
import type { ProofEffectStore } from '../jobs/complete-with-proof-effect'
import { attempts, operations } from './tables'

/** One operation with every stored row about it, as the database holds them, for tests and operators. */
export async function inspectOperation(
  database: Database,
  operationId: string,
  proofEffects: ProofEffectStore | undefined,
) {
  const [operation] = await database.db.execute<postgres.Row>(sql`
    SELECT * FROM ${operations} WHERE ${operations.id} = ${operationId}
  `)

  const attemptRows = await database.db.execute<postgres.Row>(sql`
    SELECT * FROM ${attempts} WHERE ${attempts.operationId} = ${operationId} ORDER BY ${attempts.attemptNumber}
  `)

  const effects = proofEffects ? await proofEffects.readRows(database, operationId) : []

  return { operation, attempts: attemptRows, effects }
}

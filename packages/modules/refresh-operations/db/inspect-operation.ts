import type { Database } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import type postgres from 'postgres'
import { attempts, leaderboardEffects, operations, proofEffects } from './tables'

/** One operation with every stored row about it, as the database holds them, for tests and operators. */
export async function inspectOperation(database: Database, operationId: string) {
  const [operation] = await database.db.execute<postgres.Row>(sql`
    SELECT * FROM ${operations} WHERE ${operations.id} = ${operationId}
  `)

  const attemptRows = await database.db.execute<postgres.Row>(sql`
    SELECT * FROM ${attempts} WHERE ${attempts.operationId} = ${operationId} ORDER BY ${attempts.attemptNumber}
  `)

  const effects = await database.db.execute<postgres.Row>(sql`
    SELECT * FROM ${proofEffects} WHERE ${proofEffects.operationId} = ${operationId}
  `)

  const leaderboardEffectRows = await database.db.execute<postgres.Row>(sql`
    SELECT * FROM ${leaderboardEffects} WHERE ${leaderboardEffects.operationId} = ${operationId}
  `)

  return { operation, attempts: attemptRows, effects, leaderboardEffects: leaderboardEffectRows }
}

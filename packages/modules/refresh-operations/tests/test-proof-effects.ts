import type { Database, Sql } from '@brawltome/foundation'
import type {
  DeadLetterInspection,
  ProofEffectStore,
  ProofEffectWrite,
  Transaction,
} from '@brawltome/refresh-operations'
import { sql as sqlFragment } from 'drizzle-orm'

// a queue-only test database keeps this table in the queue's schema; only accounts' migration moves it

async function testWriteProofEffect(sql: Sql, effect: ProofEffectWrite) {
  const inserted = await sql<{ operation_key: string }[]>`
    INSERT INTO refresh_operations.proof_effects (operation_key, operation_id, lease_token, effect_value)
    VALUES (${effect.operationKey}, ${effect.effectOperationId}, ${effect.leaseToken}, ${sql.json(effect.payload)})
    ON CONFLICT (operation_key) DO NOTHING
    RETURNING operation_key
  `

  return inserted[0] ? ('applied' as const) : ('already-applied' as const)
}

async function readTestRows(database: Database, operationId: string) {
  return database.sql`SELECT * FROM refresh_operations.proof_effects WHERE operation_id = ${operationId}`
}

export const testProofEffects: ProofEffectStore = { write: testWriteProofEffect, readRows: readTestRows }

export async function readTestProofEffects(
  transaction: Transaction,
  effectOperationId: string,
): Promise<DeadLetterInspection['proofEffects']> {
  const rows = await transaction.execute<{
    operation_key: string
    effect_value: { value: string }
    created_at: Date
  }>(sqlFragment`
    SELECT operation_key, effect_value, created_at FROM refresh_operations.proof_effects
    WHERE operation_id = ${effectOperationId}
    ORDER BY created_at
  `)

  return rows.map((effect) => ({
    operationKey: effect.operation_key,
    effectValue: effect.effect_value,
    createdAt: effect.created_at.toISOString(),
  }))
}

import { type Database, jsonb, type Sql } from '@brawltome/foundation'
import type {
  DeadLetterInspection,
  EffectState,
  ProofEffectPayload,
  ProofEffectStore,
  ProofEffectWrite,
  ProofEffectWriteResult,
  Transaction,
} from '@brawltome/queue'
import { asc, eq, sql as sqlFragment } from 'drizzle-orm'
import { bigint, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type postgres from 'postgres'

const accountsSchema = pgSchema('accounts')

const clockTimestamp = sqlFragment`clock_timestamp()`

export const proofEffects = accountsSchema.table('proof_effects', {
  operationKey: text('operation_key').primaryKey(),
  operationId: uuid('operation_id').notNull().unique(),
  leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
  effectValue: jsonb<ProofEffectPayload>('effect_value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

type EffectLookup = { effectOperationId: string }

export async function proofEffectState(sql: Sql, lease: EffectLookup): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM accounts.proof_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function readProofEffects(
  transaction: Transaction,
  effectOperationId: string,
): Promise<DeadLetterInspection['proofEffects']> {
  const rows = await transaction
    .select()
    .from(proofEffects)
    .where(eq(proofEffects.operationId, effectOperationId))
    .orderBy(asc(proofEffects.createdAt))

  return rows.map((effect) => ({
    operationKey: effect.operationKey,
    effectValue: effect.effectValue,
    createdAt: effect.createdAt.toISOString(),
  }))
}

async function writeProofEffect(sql: Sql, effect: ProofEffectWrite): Promise<ProofEffectWriteResult> {
  const inserted = await sql<{ operation_key: string }[]>`
    INSERT INTO accounts.proof_effects (operation_key, operation_id, lease_token, effect_value)
    VALUES (${effect.operationKey}, ${effect.effectOperationId}, ${effect.leaseToken}, ${sql.json(effect.payload)})
    ON CONFLICT (operation_key) DO NOTHING
    RETURNING operation_key
  `

  if (inserted[0]) return 'applied'

  const [existing] = await sql<{ operation_id: string; matches_payload: boolean }[]>`
    SELECT operation_id, effect_value = ${sql.json(effect.payload)}::jsonb AS matches_payload
    FROM accounts.proof_effects
    WHERE operation_key = ${effect.operationKey}
  `

  return existing?.operation_id === effect.effectOperationId && existing.matches_payload
    ? 'already-applied'
    : 'effect-conflict'
}

async function readRows(database: Database, operationId: string): Promise<postgres.Row[]> {
  return database.sql`SELECT * FROM accounts.proof_effects WHERE operation_id = ${operationId}`
}

export const proofEffectStore: ProofEffectStore = { write: writeProofEffect, readRows }

import type { Sql } from '@brawltome/foundation'
import type { DeadLetterInspection, EffectState, StatisticsCollectionKind, Transaction } from '@brawltome/queue'
import { asc, eq, sql as sqlFragment } from 'drizzle-orm'
import { bigint, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const statisticsSchema = pgSchema('statistics')

const clockTimestamp = sqlFragment`clock_timestamp()`

export const statisticsCollectionEffects = statisticsSchema.table('statistics_collection_effects', {
  operationKey: text('operation_key').primaryKey(),
  operationId: uuid('operation_id').notNull().unique(),
  kind: text('kind').$type<StatisticsCollectionKind>().notNull(),
  leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

// a publication seals the collections it read, so a sealed collection can no longer be replayed
export const statisticsCollectionSeals = statisticsSchema.table('statistics_collection_seals', {
  collectionOperationId: uuid('collection_operation_id').primaryKey(),
  publicationOperationId: uuid('publication_operation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

export const statisticsPublicationEffects = statisticsSchema.table('statistics_publication_effects', {
  operationKey: text('operation_key').primaryKey(),
  operationId: uuid('operation_id').notNull().unique(),
  leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

export const statisticsLegendMetaPublicationEffects = statisticsSchema.table(
  'statistics_legend_meta_publication_effects',
  {
    operationKey: text('operation_key').primaryKey(),
    operationId: uuid('operation_id').notNull().unique(),
    leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
  },
)

type EffectLookup = { effectOperationId: string }

export async function statisticsCollectionEffectState(sql: Sql, lease: EffectLookup): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM statistics.statistics_collection_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function statisticsPublicationEffectState(sql: Sql, lease: EffectLookup): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM statistics.statistics_publication_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function legendMetaPublicationEffectState(sql: Sql, lease: EffectLookup): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id
    FROM statistics.statistics_legend_meta_publication_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function readStatisticsEffects(
  transaction: Transaction,
  effectOperationId: string,
): Promise<DeadLetterInspection['statisticsEffects']> {
  const rows = await transaction
    .select()
    .from(statisticsCollectionEffects)
    .where(eq(statisticsCollectionEffects.operationId, effectOperationId))
    .orderBy(asc(statisticsCollectionEffects.createdAt))

  return rows.map((effect) => ({
    operationKey: effect.operationKey,
    kind: effect.kind,
    leaseToken: effect.leaseToken,
    createdAt: effect.createdAt.toISOString(),
  }))
}

// both publication tables read as one list, so this stays a union in sql
export async function readStatisticsPublicationEffects(
  transaction: Transaction,
  effectOperationId: string,
): Promise<DeadLetterInspection['statisticsPublicationEffects']> {
  const rows = await transaction.execute<{
    operation_key: string
    lease_token: string | number
    created_at: Date
  }>(sqlFragment`
    SELECT operation_key, lease_token, created_at
    FROM ${statisticsPublicationEffects}
    WHERE operation_id = ${effectOperationId}
    UNION ALL
    SELECT operation_key, lease_token, created_at
    FROM ${statisticsLegendMetaPublicationEffects}
    WHERE operation_id = ${effectOperationId}
    ORDER BY created_at
  `)

  return rows.map((effect) => ({
    operationKey: effect.operation_key,
    leaseToken: Number(effect.lease_token),
    createdAt: effect.created_at.toISOString(),
  }))
}

export async function hasStatisticsCollectionSeal(
  transaction: Transaction,
  effectOperationId: string,
): Promise<boolean> {
  const [seal] = await transaction
    .select({ collectionOperationId: statisticsCollectionSeals.collectionOperationId })
    .from(statisticsCollectionSeals)
    .where(eq(statisticsCollectionSeals.collectionOperationId, effectOperationId))

  return seal !== undefined
}

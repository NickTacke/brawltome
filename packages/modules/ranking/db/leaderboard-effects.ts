import type { Sql } from '@brawltome/foundation'
import type {
  DeadLetterInspection,
  EffectState,
  HeldLeaderboardLease,
  LeaderboardEffectResult,
  Transaction,
} from '@brawltome/refresh-operations'
import { asc, eq, inArray, sql as sqlFragment } from 'drizzle-orm'
import { bigint, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const rankingsSchema = pgSchema('rankings')

const clockTimestamp = sqlFragment`clock_timestamp()`

export const leaderboardEffects = rankingsSchema.table('leaderboard_effects', {
  operationKey: text('operation_key').primaryKey(),
  operationId: uuid('operation_id').notNull().unique(),
  operationKind: text('operation_kind').notNull(),
  leaseToken: bigint('lease_token', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
})

type EffectLookup = { effectOperationId: string }

export async function leaderboardEffectState(sql: Sql, lease: EffectLookup): Promise<EffectState> {
  const [effect] = await sql<{ operation_id: string }[]>`
    SELECT operation_id FROM rankings.leaderboard_effects
    WHERE operation_id = ${lease.effectOperationId}
  `

  return effect ? 'acknowledged' : 'none'
}

export async function readLeaderboardEffects(
  transaction: Transaction,
  effectOperationId: string,
): Promise<DeadLetterInspection['leaderboardEffects']> {
  const rows = await transaction
    .select()
    .from(leaderboardEffects)
    .where(eq(leaderboardEffects.operationId, effectOperationId))
    .orderBy(asc(leaderboardEffects.createdAt))

  return rows.map((effect) => ({
    operationKey: effect.operationKey,
    leaseToken: effect.leaseToken,
    createdAt: effect.createdAt.toISOString(),
  }))
}

export async function readAppliedLeaderboardEffects(
  transaction: Transaction,
  effectOperationIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (effectOperationIds.length === 0) return new Set()

  const rows = await transaction
    .select({ operationId: leaderboardEffects.operationId })
    .from(leaderboardEffects)
    .where(inArray(leaderboardEffects.operationId, [...effectOperationIds]))

  return new Set(rows.map(({ operationId }) => operationId))
}

export async function recordLeaderboardEffect(
  transaction: Sql,
  lease: HeldLeaderboardLease,
): Promise<LeaderboardEffectResult> {
  const [result] = await transaction<{ result: LeaderboardEffectResult }[]>`
    SELECT rankings.record_leaderboard_effect(
      ${lease.operationId},
      ${lease.operationKey},
      ${lease.operationKind},
      ${lease.leaseOwner},
      ${lease.leaseToken}
    ) AS result
  `

  return result?.result ?? 'lease-lost'
}

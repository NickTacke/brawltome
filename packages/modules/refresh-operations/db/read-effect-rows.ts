import { asc, eq, sql } from 'drizzle-orm'
import type { DeadLetterInspection } from '../model'
import {
  interactiveRefreshEffects,
  leaderboardEffects,
  proofEffects,
  statisticsCollectionEffects,
  statisticsLegendMetaPublicationEffects,
  statisticsPublicationEffects,
} from './tables'
import type { Transaction } from './transaction'

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

export async function readInteractiveEffects(
  transaction: Transaction,
  effectOperationId: string,
): Promise<DeadLetterInspection['interactiveEffects']> {
  const rows = await transaction
    .select()
    .from(interactiveRefreshEffects)
    .where(eq(interactiveRefreshEffects.operationId, effectOperationId))
    .orderBy(asc(interactiveRefreshEffects.section))

  return rows.map((effect) => ({
    section: effect.section,
    leaseToken: effect.leaseToken,
    completedAt: effect.completedAt.toISOString(),
  }))
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
  const rows = await transaction.execute<{ operation_key: string; lease_token: string | number; created_at: Date }>(sql`
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

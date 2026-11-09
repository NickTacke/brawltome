import type { Sql } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import type { Transaction } from './db/transaction'
import type { LeaderboardOperationKind } from './model'

// each fence runs in the caller's transaction, so a module's write commits only while the worker still holds the lease

export type HeldLease = {
  operationId: string
  leaseOwner: string
  leaseToken: number
}

export type HeldLeaderboardLease = HeldLease & {
  operationKey: string
  operationKind: LeaderboardOperationKind
}

export type LeaderboardEffectResult = 'applied' | 'already-applied' | 'effect-conflict' | 'lease-lost'

export async function acquireActiveLease(transaction: Sql, lease: HeldLease): Promise<boolean> {
  const [result] = await transaction<{ active: boolean }[]>`
    SELECT queue.acquire_active_lease(
      ${lease.operationId}::uuid,
      ${lease.leaseOwner},
      ${lease.leaseToken}
    ) AS active
  `

  return result?.active === true
}

/** acquireActiveLease for a module that writes through drizzle, in the caller's drizzle transaction. */
export async function acquireActiveLeaseInTransaction(transaction: Transaction, lease: HeldLease): Promise<boolean> {
  const [result] = await transaction.execute<{ active: boolean }>(sql`
    SELECT queue.acquire_active_lease(
      ${lease.operationId}::uuid,
      ${lease.leaseOwner},
      ${lease.leaseToken}
    ) AS active
  `)

  return result?.active === true
}

export async function commitInteractiveSection(
  transaction: Sql,
  lease: HeldLease & { section: 'ranked' | 'stats' },
): Promise<boolean> {
  const [result] = await transaction<{ committed: boolean }[]>`
    SELECT queue.commit_interactive_section_if_owned(
      ${lease.operationId}::uuid,
      ${lease.leaseOwner},
      ${lease.leaseToken},
      ${lease.section}
    ) AS committed
  `

  return result?.committed === true
}

export async function lockActiveLeaderboardLease(transaction: Sql, lease: HeldLeaderboardLease): Promise<boolean> {
  const [result] = await transaction<{ active: boolean }[]>`
    SELECT queue.lock_active_leaderboard_lease(
      ${lease.operationId},
      ${lease.operationKey},
      ${lease.operationKind},
      ${lease.leaseOwner},
      ${lease.leaseToken}
    ) AS active
  `

  return result?.active === true
}

export async function lockActiveRankingRetentionLease(transaction: Sql, lease: HeldLease): Promise<boolean> {
  const [result] = await transaction<{ active: boolean }[]>`
    SELECT queue.lock_active_ranking_retention_lease(
      ${lease.operationId},
      ${lease.leaseOwner},
      ${lease.leaseToken}
    ) AS active
  `

  return result?.active === true
}

export async function completeRankingRetentionLease(transaction: Sql, lease: HeldLease): Promise<boolean> {
  const [result] = await transaction<{ completed: boolean }[]>`
    SELECT queue.complete_ranking_retention_lease(
      ${lease.operationId},
      ${lease.leaseOwner},
      ${lease.leaseToken}
    ) AS completed
  `

  return result?.completed === true
}

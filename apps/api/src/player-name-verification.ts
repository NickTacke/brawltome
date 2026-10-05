import { randomUUID } from 'node:crypto'
import {
  type NameVerificationOutcome,
  type PostgresPlayerNameVerifications,
  type PostgresRankedPlayers,
  type V0RankedSource,
  refreshCanonicalRankedPlayer,
} from '@brawltome/player/composition'
import type {
  AcceptOperationResult,
  AcceptPlayerNameVerificationOperation,
  OperationLease,
} from '@brawltome/refresh-operations'
import type { SourceDomain } from '@brawltome/request-admission'
import type { Telemetry } from '@brawltome/telemetry'
import { SourceAdmissionLimitedError } from './refresh-operations-worker'

// V1 leaderboard names can be stale upstream caches or newer than a months-old V0 name. A capped trickle of
// V0 ranked calls settles which, and only while V0 is quiet, so it never competes with users for the budget.

export type PlayerNameVerificationConfig = {
  // Kill switch at 0.
  perWindow: number
  // Only start a call while total V0 usage in the admission window is below this share of the limit.
  maxUsageRatio: number
  dedupeMs: number
  staleRecheckMs: number
  intervalMs: number
  // The V0 admission window.
  windowMs: number
}

type SourceUsage = { used: number; limit: number }
type MetricOutcome = 'renamed' | 'unchanged' | 'failed' | 'skipped_budget' | 'resolved_free'
type NameVerificationLease = Extract<OperationLease, { kind: 'player-name-verification' }>

const dayMs = 24 * 60 * 60 * 1000

function boundedInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

function ratio(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) throw new Error(`${name} must be in (0, 1]`)
  return parsed
}

export function readPlayerNameVerificationConfig(env: NodeJS.ProcessEnv): PlayerNameVerificationConfig {
  return {
    // Background V0 admission tops out at 150 of 180 calls per window.
    perWindow: boundedInteger(
      env.PLAYER_NAME_VERIFICATION_PER_WINDOW,
      24,
      'PLAYER_NAME_VERIFICATION_PER_WINDOW',
      0,
      150,
    ),
    maxUsageRatio: ratio(env.PLAYER_NAME_VERIFICATION_MAX_USAGE_RATIO, 0.4, 'PLAYER_NAME_VERIFICATION_MAX_USAGE_RATIO'),
    dedupeMs:
      boundedInteger(env.PLAYER_NAME_VERIFICATION_DEDUPE_DAYS, 14, 'PLAYER_NAME_VERIFICATION_DEDUPE_DAYS', 1, 365) *
      dayMs,
    staleRecheckMs:
      boundedInteger(
        env.PLAYER_NAME_VERIFICATION_STALE_RECHECK_DAYS,
        60,
        'PLAYER_NAME_VERIFICATION_STALE_RECHECK_DAYS',
        1,
        365,
      ) * dayMs,
    intervalMs: boundedInteger(
      env.PLAYER_NAME_VERIFICATION_INTERVAL_MS,
      60_000,
      'PLAYER_NAME_VERIFICATION_INTERVAL_MS',
      5_000,
      15 * 60 * 1000,
    ),
    windowMs: 15 * 60 * 1000,
  }
}

export function sourceBudgetOpen(usage: SourceUsage, maxUsageRatio: number): boolean {
  return usage.used < Math.floor(usage.limit * maxUsageRatio)
}

function recorder(telemetry: Telemetry | undefined) {
  return (write: (active: Telemetry) => void) => {
    if (!telemetry) return
    try {
      write(telemetry)
    } catch {
      return
    }
  }
}

export function createPlayerNameVerificationPlanner(deps: {
  config: PlayerNameVerificationConfig
  readSourceUsage: () => Promise<SourceUsage>
  readDemandIds?: () => Promise<number[]>
  verifications: Pick<PostgresPlayerNameVerifications, 'claim'>
  operations: { accept(input: AcceptPlayerNameVerificationOperation): Promise<AcceptOperationResult> }
  telemetry?: Telemetry
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  const record = recorder(deps.telemetry)
  let nextRunAt = 0

  async function plan(): Promise<number> {
    const usage = await deps.readSourceUsage()
    if (!sourceBudgetOpen(usage, deps.config.maxUsageRatio)) {
      record((active) => {
        active.metrics.add('player_name_verifications_total', 1, { outcome: 'skipped_budget' })
        active.logger.info('player_name_verification.budget_closed', { used: usage.used, limit: usage.limit })
      })
      return 0
    }
    const { backlog, usedInWindow, claimed } = await deps.verifications.claim({
      perWindow: deps.config.perWindow,
      windowMs: deps.config.windowMs,
      dedupeMs: deps.config.dedupeMs,
      staleRecheckMs: deps.config.staleRecheckMs,
      demandIds: (await deps.readDemandIds?.()) ?? [],
    })
    record((active) => {
      for (const [tier, count] of Object.entries(backlog)) {
        active.metrics.set('player_name_verification_backlog', count, { tier })
      }
    })
    let enqueued = 0
    const releaseClaim = async (brawlhallaId: number, playerName: string) => {
      try {
        await deps.verifications.release(brawlhallaId, playerName)
      } catch (error) {
        record((active) => active.logger.error('player_name_verification.release_failed', error))
      }
    }
    for (const { brawlhallaId, playerName } of claimed) {
      try {
        // An operation already in flight for this player keeps the claim; its preparation re-checks the pair.
        const accepted = await deps.operations.accept({
          kind: 'player-name-verification',
          dedupeKey: `player-name-verification:${brawlhallaId}`,
          operationKey: `player-name-verification:${brawlhallaId}:${randomUUID()}`,
          workClass: 'maintenance',
          payload: { brawlhallaId, playerName },
          provenance: { source: 'player-name-verification' },
        })
        if (accepted.outcome === 'accepted') enqueued++
        else if (accepted.outcome !== 'already-active') await releaseClaim(brawlhallaId, playerName)
      } catch (error) {
        record((active) => active.logger.error('player_name_verification.enqueue_failed', error))
        // No operation will run this claim, so it must not hold the pair (and the window budget) for a day.
        await releaseClaim(brawlhallaId, playerName)
      }
    }
    if (claimed.length > 0) {
      record((active) =>
        active.logger.info('player_name_verification.planned', {
          ...backlog,
          usedInWindow,
          enqueued,
          sourceUsed: usage.used,
        }),
      )
    }
    return enqueued
  }

  return {
    // Never throws: a failed plan only delays verification to the next interval.
    async tick(): Promise<number> {
      if (deps.config.perWindow === 0 || now() < nextRunAt) return 0
      nextRunAt = now() + deps.config.intervalMs
      try {
        return await plan()
      } catch (error) {
        record((active) => active.logger.error('player_name_verification.plan_failed', error))
        return 0
      }
    },
  }
}

const metricOutcome = (outcome: NameVerificationOutcome): MetricOutcome =>
  outcome === 'confirmed_stale' ? 'unchanged' : outcome

export async function executePlayerNameVerification(deps: {
  config: PlayerNameVerificationConfig
  verification: { brawlhallaId: number; playerName: string }
  readSourceUsage: () => Promise<SourceUsage>
  verifications: Pick<PostgresPlayerNameVerifications, 'prepare' | 'release' | 'recordChecked' | 'recordFailed'>
  refreshRanked(onAttempt: () => void): Promise<void>
  telemetry?: Telemetry
}): Promise<MetricOutcome> {
  const { brawlhallaId, playerName } = deps.verification
  const record = recorder(deps.telemetry)
  const finish = (outcome: MetricOutcome, error?: unknown) => {
    record((active) => {
      active.metrics.add('player_name_verifications_total', 1, { outcome })
      if (error) active.logger.warn('player_name_verification.completed', { brawlhallaId, outcome })
      else active.logger.info('player_name_verification.completed', { brawlhallaId, outcome })
    })
    return outcome
  }

  // A visit or monitoring refresh since the claim settled it, or the leaderboard moved on: no call needed.
  const preparation = await deps.verifications.prepare(brawlhallaId, playerName)
  if (preparation.state !== 'needed') return finish('resolved_free')
  // Queued work may run long after planning; re-check the usage gate right before spending the call.
  if (deps.config.perWindow === 0 || !sourceBudgetOpen(await deps.readSourceUsage(), deps.config.maxUsageRatio)) {
    await deps.verifications.release(brawlhallaId, playerName)
    return finish('skipped_budget')
  }
  let attempted = false
  try {
    await deps.refreshRanked(() => {
      attempted = true
    })
  } catch (error) {
    if (!attempted) {
      // No call was made, so the claim neither counts against the window nor dedupes the pair.
      await deps.verifications.release(brawlhallaId, playerName)
      return finish(error instanceof SourceAdmissionLimitedError ? 'skipped_budget' : 'failed', error)
    }
    return finish(metricOutcome(await deps.verifications.recordFailed(brawlhallaId, playerName)), error)
  }
  return finish(metricOutcome(await deps.verifications.recordChecked(brawlhallaId, playerName)))
}

// Applies the V0 ranked snapshot through the normal ranked refresh path, fenced by the operation lease.
export function createPlayerNameVerificationExecutor(deps: {
  config: PlayerNameVerificationConfig
  readSourceUsage: () => Promise<SourceUsage>
  verifications: Pick<PostgresPlayerNameVerifications, 'prepare' | 'release' | 'recordChecked' | 'recordFailed'>
  rankedPlayers: PostgresRankedPlayers
  rankedSource(admitSourceCall: (domain: SourceDomain) => Promise<void>): V0RankedSource
  telemetry?: Telemetry
}) {
  return async (lease: NameVerificationLease, admitSourceCall: (domain: SourceDomain) => Promise<void>) => {
    const source = deps.rankedSource(admitSourceCall)
    return executePlayerNameVerification({
      config: deps.config,
      verification: lease.payload,
      readSourceUsage: deps.readSourceUsage,
      verifications: deps.verifications,
      telemetry: deps.telemetry,
      refreshRanked: async (onAttempt) => {
        await refreshCanonicalRankedPlayer(
          deps.rankedPlayers,
          {
            getRanked: (brawlhallaId, options) =>
              source.getRanked(brawlhallaId, {
                ...options,
                onAttempt: () => {
                  onAttempt()
                  options.onAttempt()
                },
              }),
          },
          lease.payload.brawlhallaId,
          { caller: 'background' },
          {
            operationId: lease.operationId,
            effectOperationId: lease.effectOperationId,
            leaseOwner: lease.leaseOwner,
            leaseToken: lease.leaseToken,
            effectCreatedAt: lease.effectCreatedAt,
            section: 'ranked',
          },
        )
      },
    })
  }
}

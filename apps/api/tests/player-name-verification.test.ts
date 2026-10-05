import { describe, expect, test } from 'bun:test'
import type { NameVerificationPreparation } from '@brawltome/player/composition'
import { createTelemetry } from '@brawltome/telemetry'
import {
  createPlayerNameVerificationPlanner,
  executePlayerNameVerification,
  readPlayerNameVerificationConfig,
  sourceBudgetOpen,
} from '../src/player-name-verification'
import { SourceAdmissionLimitedError } from '../src/refresh-operations-worker'

const config = readPlayerNameVerificationConfig({})
const candidate = { brawlhallaId: 7, playerName: 'New', v0Name: 'Old' }
const backlog = { rename_signal: 2, demand: 3, other: 40 }

function metric(telemetry: ReturnType<typeof createTelemetry>, name: string, label: string) {
  const found = telemetry.metrics.snapshot().find((item) => item.name === name)
  return Object.fromEntries((found?.series ?? []).map(({ labels, value }) => [labels[label], value]))
}
const counters = (telemetry: ReturnType<typeof createTelemetry>) =>
  metric(telemetry, 'player_name_verifications_total', 'outcome')

function plannerFixture(options: { usage?: () => number; perWindow?: number } = {}) {
  const calls = { usage: 0, demand: 0, claim: [] as unknown[], accept: [] as unknown[] }
  const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
  let now = 1_000_000
  const planner = createPlayerNameVerificationPlanner({
    config: { ...config, perWindow: options.perWindow ?? config.perWindow },
    readSourceUsage: async () => {
      calls.usage++
      return { used: options.usage?.() ?? 0, limit: 180 }
    },
    readDemandIds: async () => {
      calls.demand++
      return [7, 9]
    },
    verifications: {
      claim: async (policy) => {
        calls.claim.push(policy)
        return { backlog, usedInWindow: 0, claimed: [candidate] }
      },
      release: async () => {},
    },
    operations: {
      accept: async (input) => {
        calls.accept.push(input)
        return { outcome: 'accepted', operationId: 'operation' }
      },
    },
    telemetry,
    now: () => now,
  })
  return {
    planner,
    calls,
    telemetry,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('player name verification config', () => {
  test('defaults to 24 checks per window below 40% V0 usage', () => {
    expect(config).toEqual({
      perWindow: 24,
      maxUsageRatio: 0.4,
      dedupeMs: 14 * 24 * 60 * 60 * 1000,
      staleRecheckMs: 60 * 24 * 60 * 60 * 1000,
      intervalMs: 60_000,
      windowMs: 15 * 60 * 1000,
    })
    expect(readPlayerNameVerificationConfig({ PLAYER_NAME_VERIFICATION_PER_WINDOW: '0' }).perWindow).toBe(0)
    expect(readPlayerNameVerificationConfig({ PLAYER_NAME_VERIFICATION_MAX_USAGE_RATIO: '0.25' }).maxUsageRatio).toBe(
      0.25,
    )
    expect(readPlayerNameVerificationConfig({ PLAYER_NAME_VERIFICATION_STALE_RECHECK_DAYS: '30' }).staleRecheckMs).toBe(
      30 * 24 * 60 * 60 * 1000,
    )
    expect(() => readPlayerNameVerificationConfig({ PLAYER_NAME_VERIFICATION_PER_WINDOW: '151' })).toThrow()
    expect(() => readPlayerNameVerificationConfig({ PLAYER_NAME_VERIFICATION_MAX_USAGE_RATIO: '0' })).toThrow()
    expect(() => readPlayerNameVerificationConfig({ PLAYER_NAME_VERIFICATION_MAX_USAGE_RATIO: '1.5' })).toThrow()
  })

  test('the source budget is open only below the usage ratio', () => {
    expect(sourceBudgetOpen({ used: 71, limit: 180 }, 0.4)).toBe(true)
    expect(sourceBudgetOpen({ used: 72, limit: 180 }, 0.4)).toBe(false)
  })
})

describe('player name verification planner', () => {
  test('claims with demand and enqueues low-priority maintenance work, reporting the backlog by tier', async () => {
    const { planner, calls, telemetry } = plannerFixture()
    expect(await planner.tick()).toBe(1)
    expect(calls.claim).toEqual([
      {
        perWindow: 24,
        windowMs: 15 * 60 * 1000,
        dedupeMs: config.dedupeMs,
        staleRecheckMs: config.staleRecheckMs,
        demandIds: [7, 9],
      },
    ])
    expect(calls.accept).toEqual([
      expect.objectContaining({
        kind: 'player-name-verification',
        workClass: 'maintenance',
        dedupeKey: 'player-name-verification:7',
        payload: { brawlhallaId: 7, playerName: 'New' },
      }),
    ])
    expect(metric(telemetry, 'player_name_verification_backlog', 'tier')).toEqual(backlog)
  })

  test('releases a claim whose operation was not accepted without failing the rest of the batch', async () => {
    const released: Array<[number, string]> = []
    const accepted: number[] = []
    const planner = createPlayerNameVerificationPlanner({
      config,
      readSourceUsage: async () => ({ used: 0, limit: 180 }),
      verifications: {
        claim: async () => ({
          backlog,
          usedInWindow: 0,
          claimed: [
            { brawlhallaId: 7, playerName: 'New', v0Name: 'Old' },
            { brawlhallaId: 8, playerName: 'Newer', v0Name: 'Older' },
          ],
        }),
        release: async (brawlhallaId, playerName) => {
          released.push([brawlhallaId, playerName])
        },
      },
      operations: {
        accept: async (input) => {
          if (input.payload.brawlhallaId === 7) throw new Error('database unavailable')
          accepted.push(input.payload.brawlhallaId)
          return { outcome: 'accepted', operationId: 'operation' }
        },
      },
    })
    expect(await planner.tick()).toBe(1)
    expect(accepted).toEqual([8])
    expect(released).toEqual([[7, 'New']])
  })

  test('the kill switch makes no database or source reads', async () => {
    const { planner, calls } = plannerFixture({ perWindow: 0 })
    expect(await planner.tick()).toBe(0)
    expect(calls).toEqual({ usage: 0, demand: 0, claim: [], accept: [] })
  })

  test('stops above the usage ratio and resumes once V0 is quiet again', async () => {
    let used = 72
    const { planner, calls, telemetry, advance } = plannerFixture({ usage: () => used })
    expect(await planner.tick()).toBe(0)
    expect(calls.claim).toEqual([])
    expect(counters(telemetry)).toEqual({ skipped_budget: 1 })
    used = 71
    advance(60_000)
    expect(await planner.tick()).toBe(1)
    expect(calls.claim).toHaveLength(1)
  })

  test('runs at most once per interval', async () => {
    const { planner, calls, advance } = plannerFixture()
    await planner.tick()
    await planner.tick()
    expect(calls.claim).toHaveLength(1)
    advance(60_000)
    await planner.tick()
    expect(calls.claim).toHaveLength(2)
  })
})

describe('player name verification execution', () => {
  function executionFixture(
    options: {
      usage?: () => number
      preparation?: NameVerificationPreparation
      refresh?: (onAttempt: () => void) => Promise<void>
    } = {},
  ) {
    const calls = { release: [] as unknown[], checked: [] as unknown[], failed: [] as unknown[], refresh: 0 }
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const run = () =>
      executePlayerNameVerification({
        config,
        verification: { brawlhallaId: 7, playerName: 'New' },
        readSourceUsage: async () => ({ used: options.usage?.() ?? 0, limit: 180 }),
        verifications: {
          prepare: async () => options.preparation ?? { state: 'needed' },
          release: async (...args) => {
            calls.release.push(args)
          },
          recordChecked: async (...args) => {
            calls.checked.push(args)
            return 'confirmed_stale'
          },
          recordFailed: async (...args) => {
            calls.failed.push(args)
            return 'failed'
          },
        },
        refreshRanked: async (onAttempt) => {
          calls.refresh++
          await (options.refresh ?? (async (attempt) => attempt()))(onAttempt)
        },
        telemetry,
      })
    return { run, calls, telemetry }
  }

  test('records the V0 outcome after one ranked refresh', async () => {
    const { run, calls, telemetry } = executionFixture()
    expect(await run()).toBe('unchanged')
    expect(calls).toMatchObject({ refresh: 1, checked: [[7, 'New']], release: [] })
    expect(counters(telemetry)).toEqual({ unchanged: 1 })
  })

  test('a refresh that already happened resolves the claim without a call', async () => {
    const { run, calls, telemetry } = executionFixture({ preparation: { state: 'resolved', outcome: 'renamed' } })
    expect(await run()).toBe('resolved_free')
    expect(calls.refresh).toBe(0)
    expect(counters(telemetry)).toEqual({ resolved_free: 1 })
  })

  test('re-checks the usage ratio right before every call and releases the claim', async () => {
    let used = 100
    const { run, calls, telemetry } = executionFixture({ usage: () => used })
    expect(await run()).toBe('skipped_budget')
    expect(calls).toMatchObject({ refresh: 0, release: [[7, 'New']] })
    used = 10
    expect(await run()).toBe('unchanged')
    expect(calls.refresh).toBe(1)
    expect(counters(telemetry)).toEqual({ skipped_budget: 1, unchanged: 1 })
  })

  test('releases the claim when source admission refuses the call', async () => {
    const { run, calls, telemetry } = executionFixture({
      refresh: async () => {
        throw new SourceAdmissionLimitedError(30)
      },
    })
    expect(await run()).toBe('skipped_budget')
    expect(calls.release).toEqual([[7, 'New']])
    expect(counters(telemetry)).toEqual({ skipped_budget: 1 })
  })

  test('a failed call is spent and recorded for backoff, never retried in place', async () => {
    const { run, calls, telemetry } = executionFixture({
      refresh: async (onAttempt) => {
        onAttempt()
        throw new Error('upstream 500')
      },
    })
    expect(await run()).toBe('failed')
    expect(calls).toMatchObject({ refresh: 1, failed: [[7, 'New']], release: [] })
    expect(counters(telemetry)).toEqual({ failed: 1 })
  })
})

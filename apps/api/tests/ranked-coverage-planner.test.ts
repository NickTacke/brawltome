import { describe, expect, test } from 'bun:test'
import type { RankedCoverageCandidate } from '@brawltome/player'
import { createTelemetry } from '@brawltome/telemetry'
import {
  createRankedCoveragePlanner,
  type RankedCoveragePlannerConfig,
  readRankedCoveragePlannerConfig,
} from '../src/ranked-coverage-planner'

const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs
const startMs = Date.parse('2026-11-23T12:00:00Z')

type FakeState = {
  nowMs: number
  pausedUntil: Date | null
  used: number
  interactive: number
  background: number
  candidates: RankedCoverageCandidate[]
  // what the database says now, when it differs from the candidate read
  lastSuccess: Map<number, Date>
  enqueued: number[]
  boardReads: number
}

function createFakes(config: Partial<RankedCoveragePlannerConfig> = {}) {
  const state: FakeState = {
    nowMs: startMs,
    pausedUntil: null,
    used: 10,
    interactive: 0,
    background: 0,
    candidates: [
      { brawlhallaId: 1, rating: 2300, lastSuccessAt: new Date(startMs - 30 * hourMs) },
      { brawlhallaId: 2, rating: 2100, lastSuccessAt: null },
      { brawlhallaId: 3, rating: 1900, lastSuccessAt: new Date(startMs - 10 * dayMs) },
      // fresh for its band: never picked
      { brawlhallaId: 4, rating: 2300, lastSuccessAt: new Date(startMs - 2 * hourMs) },
    ],
    lastSuccess: new Map(),
    enqueued: [],
    boardReads: 0,
  }

  const telemetry = createTelemetry({ service: 'test', drainIntervalMs: 0 })

  const planner = createRankedCoveragePlanner({
    config: { enabled: true, callSpacingMs: 15_000, maxUsageRatio: 0.5, ...config },
    readSourceUsage: async () => ({ used: state.used, limit: 180 }),
    readSourcePausedUntil: async () => state.pausedUntil,
    coverage: {
      candidates: async () => {
        state.boardReads++

        return state.candidates
      },
      lastRankedSuccess: async (brawlhallaId) =>
        state.lastSuccess.get(brawlhallaId) ??
        state.candidates.find((candidate) => candidate.brawlhallaId === brawlhallaId)?.lastSuccessAt ??
        null,
    },
    operations: {
      activeBackgroundPlayerRefreshes: async () => state.background,
      activeInteractivePlayerRefreshes: async () => state.interactive,
      enqueueRankedCoverageRefresh: async (brawlhallaId) => {
        state.enqueued.push(brawlhallaId)

        return true
      },
      recentRankedCoverageAttempts: async () => [],
    },
    telemetry,
    now: () => state.nowMs,
  })

  const advance = (ms: number) => {
    state.nowMs += ms
  }

  const counter = (name: string, labels: Record<string, string>) =>
    telemetry.metrics
      .snapshot()
      .find((metric) => metric.name === name)
      ?.series.find((series) => Object.entries(labels).every(([key, value]) => series.labels[key] === value))?.value ??
    0

  return { state, planner, advance, counter }
}

describe('ranked coverage planner config', () => {
  test('ships disabled, paced at one call every 15 s, with bounded overrides', () => {
    expect(readRankedCoveragePlannerConfig({})).toEqual({ enabled: false, callSpacingMs: 15_000, maxUsageRatio: 0.5 })

    expect(readRankedCoveragePlannerConfig({ RANKED_COVERAGE_ENABLED: 'true' }).enabled).toBe(true)
    expect(() => readRankedCoveragePlannerConfig({ RANKED_COVERAGE_ENABLED: 'yes' })).toThrow('RANKED_COVERAGE_ENABLED')

    expect(() => readRankedCoveragePlannerConfig({ RANKED_COVERAGE_CALL_SPACING_MS: '1000' })).toThrow(
      'RANKED_COVERAGE_CALL_SPACING_MS',
    )

    expect(() => readRankedCoveragePlannerConfig({ RANKED_COVERAGE_V0_MAX_USAGE_RATIO: '0.9' })).toThrow(
      'RANKED_COVERAGE_V0_MAX_USAGE_RATIO',
    )
  })
})

describe('ranked coverage planner', () => {
  test('requests the stalest due player first and paces one call per spacing', async () => {
    const { state, planner, advance, counter } = createFakes()

    expect(await planner.tick()).toBe(1)
    expect(state.enqueued).toEqual([2])

    // within the spacing nothing else is requested, even with the slot free
    advance(14_999)
    expect(await planner.tick()).toBe(0)
    expect(state.enqueued).toEqual([2])

    advance(1)
    expect(await planner.tick()).toBe(1)
    advance(15_000)
    expect(await planner.tick()).toBe(1)
    expect(state.enqueued).toEqual([2, 3, 1])

    // everyone due is requested until the boards are read again
    advance(15_000)
    expect(await planner.tick()).toBe(0)
    expect(counter('ranked_coverage_skips_total', { reason: 'nothing_due' })).toBe(1)
    expect(counter('ranked_coverage_refreshes_total', { band: '2000-2199', outcome: 'enqueued' })).toBe(1)
    expect(state.boardReads).toBe(1)
  })

  test('yields while a visitor refresh is in flight and goes on once it settles', async () => {
    const { state, planner, advance, counter } = createFakes()

    state.interactive = 1

    expect(await planner.tick()).toBe(0)
    expect(state.enqueued).toEqual([])
    expect(counter('ranked_coverage_skips_total', { reason: 'interactive' })).toBe(1)

    state.interactive = 0

    // a yield costs a short recheck, not a whole spacing
    advance(2_000)
    expect(await planner.tick()).toBe(1)
    expect(state.enqueued).toEqual([2])
  })

  test('waits while another background player refresh holds the slot or the budget is past its share', async () => {
    const { state, planner, advance, counter } = createFakes()

    state.background = 1
    expect(await planner.tick()).toBe(0)
    expect(counter('ranked_coverage_skips_total', { reason: 'slot_busy' })).toBe(1)

    state.background = 0
    state.used = 90
    advance(2_000)
    expect(await planner.tick()).toBe(0)
    expect(counter('ranked_coverage_skips_total', { reason: 'budget' })).toBe(1)

    state.used = 89
    advance(2_000)
    expect(await planner.tick()).toBe(1)
  })

  test('pauses until a 503 or 429 pause on the V0 source ends', async () => {
    const { state, planner, advance, counter } = createFakes()

    state.pausedUntil = new Date(startMs + 60_000)

    expect(await planner.tick()).toBe(0)
    expect(counter('ranked_coverage_skips_total', { reason: 'source_paused' })).toBe(1)

    // no further look at the source until the pause is over
    advance(59_999)
    expect(await planner.tick()).toBe(0)
    expect(counter('ranked_coverage_skips_total', { reason: 'source_paused' })).toBe(1)

    state.pausedUntil = null
    advance(1)
    expect(await planner.tick()).toBe(1)
    expect(state.enqueued).toEqual([2])
  })

  test('drops a player someone refreshed after the boards were read', async () => {
    const { state, planner } = createFakes()

    state.lastSuccess.set(2, new Date(startMs - 1_000))

    expect(await planner.tick()).toBe(1)
    expect(state.enqueued).toEqual([3])
  })

  test('reports coverage without requesting refreshes while disabled', async () => {
    const { state, planner, advance, counter } = createFakes({ enabled: false })

    expect(await planner.tick()).toBe(0)
    expect(state.enqueued).toEqual([])
    expect(counter('ranked_coverage_players', { band: '2200+', age: 'under_1_day' })).toBe(1)
    expect(counter('ranked_coverage_players', { band: '2200+', age: '1_to_2_days' })).toBe(1)
    expect(counter('ranked_coverage_due_players', { band: '2200+' })).toBe(1)

    // the boards are read again after five minutes, not on every pass
    advance(60_000)
    expect(await planner.tick()).toBe(0)
    expect(state.boardReads).toBe(1)

    advance(4 * 60_000)
    await planner.tick()
    expect(state.boardReads).toBe(2)
  })

  test('never throws from a failed pass and tries the read again later', async () => {
    const { state, planner, advance } = createFakes()
    const candidates = state.candidates

    state.candidates = null as never
    expect(await planner.tick()).toBe(0)

    state.candidates = candidates
    advance(15_000)
    expect(await planner.tick()).toBe(1)
  })
})

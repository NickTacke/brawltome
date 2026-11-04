import { describe, expect, test } from 'bun:test'
import { type LaunchCohortCapacityEnvelope, launchCohortBrackets, launchCohortRegions } from '../cohort'
import { validatePublicationDecision } from '../publication'

const startsAt = '2026-08-10T00:00:00.000Z'
const endsAt = '2026-08-17T00:00:00.000Z'

function progress(successes = 119, selectedPlayers = 125) {
  return launchCohortRegions.flatMap((region) =>
    launchCohortBrackets.map((bracket) => ({
      region,
      bracket,
      selectedPlayers,
      operations: selectedPlayers,
      sourceAttempts: selectedPlayers,
      maximumPlayerAttempts: 1,
      successes,
      firstAttemptAt: '2026-08-10T01:00:00.000Z',
      lastCompletedAt: '2026-08-12T00:00:00.000Z',
    })),
  )
}

function capacity(selectedPlayers = 2_250): LaunchCohortCapacityEnvelope {
  const plannedRequests = selectedPlayers * 2
  const maximumSourceAttempts = plannedRequests * 3
  return {
    sourceDomain: 'brawlhalla-v1',
    quotaUnitsPerWindow: 150,
    quotaWindowSeconds: 900,
    requestsPerPlayer: 2,
    maxAttemptsPerRequest: 3,
    plannedRequests,
    maximumSourceAttempts,
    minimumCapacitySeconds: Math.ceil(maximumSourceAttempts / 150) * 900,
    observationWindowSeconds: 604_800,
  }
}

function validate(cells = progress(), product: 'ranked' | 'lifetime' = 'ranked') {
  const selectedPlayers = cells.reduce((total, cell) => total + cell.selectedPlayers, 0)
  return validatePublicationDecision({
    generationId: '10000000-0000-4000-8000-000000000001',
    product,
    cells,
    observationWindow: { startsAt, endsAt },
    capacityEnvelope: capacity(selectedPlayers),
  })
}

describe('Statistics publication validation', () => {
  test('accepts coverage above 95% while retaining independent per-cell and product progress', () => {
    const cells = progress()
    for (let index = 0; index < 4; index++) cells[index].successes = 118
    const ranked = validate(cells, 'ranked')
    const lifetime = validate(progress(), 'lifetime')

    expect(ranked.outcome).toBe('accepted')
    expect(ranked.reasons).toEqual([])
    expect(ranked.progress).toMatchObject({
      product: 'ranked',
      selectedPlayers: 2_250,
      operations: 2_250,
      sourceAttempts: 2_250,
      successes: 2_138,
      overallCoverageBasisPoints: 9_502,
    })
    expect(ranked.progress.cells).toHaveLength(18)
    expect(lifetime.progress).toMatchObject({ product: 'lifetime', successes: 2_142 })
  })

  test('accepts the exact 95% overall and 90% per-cell boundaries', () => {
    const exactOverall = validate(progress(190, 200))
    const exactCell = progress(200, 200)
    exactCell[0].successes = 180

    expect(exactOverall.outcome).toBe('accepted')
    expect(exactOverall.progress.overallCoverageBasisPoints).toBe(9_500)
    expect(validate(exactCell).outcome).toBe('accepted')
    expect(validate(exactCell).progress.cells[0].coverageBasisPoints).toBe(9_000)
  })

  test('rejects below 95% overall even when every cell exceeds 90%', () => {
    const cells = progress()
    for (let index = 0; index < 5; index++) cells[index].successes = 118
    const decision = validate(cells)

    expect(decision.outcome).toBe('rejected')
    expect(decision.reasons).toContainEqual({ code: 'overall-coverage-below-95-percent' })
  })

  test('rejects one cell below 90% even when overall coverage exceeds 95%', () => {
    const cells = progress(125)
    cells[0].successes = 112
    const decision = validate(cells)

    expect(decision.outcome).toBe('rejected')
    expect(decision.reasons).toContainEqual({
      code: 'cell-coverage-below-90-percent',
      region: 'US-E',
      bracket: 'Platinum',
    })
  })

  test('audits every-cell minimum, operation completion, observation window, and capacity failures together', () => {
    const cells = progress(125)
    cells[0] = {
      ...cells[0],
      selectedPlayers: 124,
      operations: 123,
      sourceAttempts: 13_501,
      maximumPlayerAttempts: 4,
      successes: 123,
      firstAttemptAt: '2026-08-09T23:59:59.999Z',
      lastCompletedAt: '2026-08-17T00:00:00.001Z',
    }
    const decision = validatePublicationDecision({
      generationId: '10000000-0000-4000-8000-000000000001',
      product: 'ranked',
      cells,
      observationWindow: { startsAt, endsAt },
      capacityEnvelope: capacity(2_249),
    })

    expect(decision.outcome).toBe('rejected')
    expect(decision.reasons.map(({ code }) => code)).toEqual([
      'cell-minimum-not-met',
      'collection-operations-incomplete',
      'observation-window-violated',
      'capacity-envelope-exceeded',
    ])
    expect(decision.observationWindow).toEqual({ startsAt, endsAt })
    expect(decision.capacityEnvelope.maximumSourceAttempts).toBe(13_494)
  })

  test('enforces the product half of the shared envelope and three attempts per player across replays', () => {
    const productOverflow = progress(119)
    for (const cell of productOverflow) cell.sourceAttempts = 376
    const replayOverflow = progress(119)
    replayOverflow[0].maximumPlayerAttempts = 4

    expect(validate(productOverflow).reasons).toContainEqual({ code: 'capacity-envelope-exceeded' })
    expect(validate(replayOverflow).reasons).toContainEqual({ code: 'capacity-envelope-exceeded' })
  })

  test('rejects a capacity envelope that changes the fixed shared source policy', () => {
    const changed = {
      ...capacity(),
      quotaUnitsPerWindow: 151,
      quotaWindowSeconds: 901,
    } as unknown as LaunchCohortCapacityEnvelope
    const decision = validatePublicationDecision({
      generationId: '10000000-0000-4000-8000-000000000001',
      product: 'ranked',
      cells: progress(),
      observationWindow: { startsAt, endsAt },
      capacityEnvelope: changed,
    })

    expect(decision.reasons).toContainEqual({ code: 'capacity-envelope-exceeded' })
  })

  test('rejects a missing, duplicate, or unexpected launch cell', () => {
    expect(() => validate(progress().slice(1))).toThrow('exactly 18 launch cells')
    const duplicate = progress()
    duplicate[17] = { ...duplicate[0] }
    expect(() => validate(duplicate)).toThrow('exactly one progress row per launch cell')
  })
})

import { describe, expect, test } from 'bun:test'
import {
  type StatisticsQueries,
  buildLegendMetaArtifact,
  launchCohortBrackets,
  launchCohortRegions,
} from '@brawltome/statistics'
import { statisticsRouter } from '../src/router/statistics.router'
import type { Context } from '../src/trpc/context'

function callerFor(getLegendMeta: StatisticsQueries['getLegendMeta']) {
  const statisticsQueries: StatisticsQueries = { getLegendMeta }
  return statisticsRouter.createCaller({ statisticsQueries } as unknown as Context)
}

function availableResult() {
  let playerId = 1
  const artifact = buildLegendMetaArtifact({
    snapshotId: '10000000-0000-4000-8000-000000000001',
    generationId: '10000000-0000-4000-8000-000000000002',
    cohortMethodologyVersion: 'full-launch-cohort-v1',
    sourceGenerationId: '10000000-0000-4000-8000-000000000003',
    sourceObservedAt: '2026-08-10T00:00:00.000Z',
    observationWindow: {
      startsAt: '2026-08-10T00:00:00.000Z',
      endsAt: '2026-08-17T00:00:00.000Z',
    },
    publishedAt: '2026-08-12T00:00:00.000Z',
    legends: [{ legendId: 3, name: 'BÖDVAR', slug: 'bodvar' }],
    cells: launchCohortRegions.flatMap((region) =>
      launchCohortBrackets.map((bracket) => ({
        region,
        bracket,
        selectedPlayers: 1,
        observations: [
          {
            brawlhallaId: playerId++,
            rating: 2_000,
            legends: [{ legendId: 3, games: 10, wins: 5 }],
          },
        ],
      })),
    ),
  })
  const slice = artifact.slices.find(({ region, bracket }) => region === 'EU' && bracket === 'Platinum')
  if (!slice) throw new Error('fixture slice missing')
  const { slices: _slices, ...snapshot } = artifact
  return {
    ...snapshot,
    status: 'fresh' as const,
    staleReason: null,
    region: 'EU' as const,
    bracket: 'Platinum' as const,
    slice,
  }
}

describe('statistics.legendMeta', () => {
  test('forwards independent filters only to the Statistics capability and maps explicit insufficiency', async () => {
    const calls: unknown[] = []
    const caller = callerFor(async (input) => {
      calls.push(input)
      return availableResult()
    })

    const output = await caller.legendMeta({ region: 'EU', bracket: 'Platinum' })
    expect(output).toMatchObject({
      status: 'fresh',
      filter: { region: 'EU', bracket: 'Platinum' },
      coverage: { numerator: 1, denominator: 1, basisPoints: 10_000 },
      rows: [
        {
          legend: { legendId: 3, name: 'BÖDVAR', slug: 'bodvar' },
          rank: null,
          eligibility: { status: 'insufficient-sample', minimumPlayers: 30, minimumGames: 200 },
          playerCount: 1,
          gameCount: 10,
          winRate: { numerator: 5, denominator: 10, basisPoints: 5_000 },
        },
      ],
    })
    expect(calls).toEqual([{ region: 'EU', bracket: 'Platinum' }])
  })

  test('maps not-yet-published without inventing an empty snapshot', async () => {
    const caller = callerFor(async (input) => ({
      status: 'unavailable',
      reason: 'not-yet-published',
      ...input,
    }))

    await expect(caller.legendMeta({ region: 'all', bracket: 'all' })).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_yet_published',
      filter: { region: 'all', bracket: 'all' },
    })
  })

  test('rejects malformed producer output and unknown filter fields', async () => {
    const malformed = callerFor(async () => {
      const result = availableResult()
      result.slice.rows[0].pickShare.basisPoints = 9_999
      return result
    })

    await expect(malformed.legendMeta({ region: 'EU', bracket: 'Platinum' })).rejects.toThrow()
    await expect(malformed.legendMeta({ region: 'EU', bracket: 'Platinum', season: 38 } as never)).rejects.toThrow()
  })
})

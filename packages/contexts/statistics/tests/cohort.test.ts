import { describe, expect, test } from 'bun:test'
import {
  FULL_LAUNCH_COHORT_METHODOLOGY_VERSION,
  launchCohortBrackets,
  launchCohortRegions,
  selectFullLaunchCohort,
  selectLaunchCohort,
} from '../cohort'

const snapshot = (ratings: Array<[number, number]>) => ({
  snapshotId: '00000000-0000-4000-8000-000000000001',
  generationId: '00000000-0000-4000-8000-000000000002',
  observedAt: '2026-08-10T00:00:00.000Z',
  region: 'EU' as const,
  mode: '1v1' as const,
  candidates: ratings.map(([brawlhallaId, rating]) => ({ brawlhallaId, rating })),
})

describe('EU Diamond+ launch cohort selection', () => {
  test('uses rating and a version-salted known SHA-256 ordering', () => {
    const selected = selectLaunchCohort(
      snapshot([
        [42, 2000],
        [7, 3000],
        [99, 1999],
      ]),
    )

    expect(selected.members).toEqual([
      {
        brawlhallaId: 7,
        sourceRating: 3000,
        ordinal: 1,
        selectionHash: '91c12fe1a0fd2f4f7ef8a14adf892e0c6b6de26ebef930e64d92088cd3a500fc',
      },
      {
        brawlhallaId: 42,
        sourceRating: 2000,
        ordinal: 2,
        selectionHash: 'dc9c8f8aa1d401d16e1776b6279590186bfccd7c761a6bae27fc735e622dc30f',
      },
    ])
    expect(selected.eligiblePlayers).toBe(2)
    expect(selected.state).toBe('insufficient-evidence')
  })

  test('is input-order independent, collapses identical duplicates, and rejects conflicting ratings', () => {
    const first = selectLaunchCohort(
      snapshot([
        [3, 2100],
        [1, 2200],
        [3, 2100],
        [2, 2300],
      ]),
    )
    const second = selectLaunchCohort(
      snapshot([
        [2, 2300],
        [3, 2100],
        [1, 2200],
      ]),
    )
    expect(first.members).toEqual(second.members)
    expect(() =>
      selectLaunchCohort(
        snapshot([
          [3, 2100],
          [3, 2200],
        ]),
      ),
    ).toThrow('conflicting ratings')
  })

  test('changes ordering when the methodology version changes', () => {
    const candidates = snapshot(Array.from({ length: 20 }, (_, index) => [index + 1, 2000 + index]))
    const first = selectLaunchCohort(candidates)
    const second = selectLaunchCohort(candidates, 'eu-diamond-tracer-v2')
    expect(first.members.map((member) => member.brawlhallaId)).not.toEqual(
      second.members.map((member) => member.brawlhallaId),
    )
  })

  test('caps at 750 and records the 124/125 minimum evidence boundary', () => {
    const candidates = (count: number) => snapshot(Array.from({ length: count }, (_, index) => [index + 1, 2000]))
    expect(selectLaunchCohort(candidates(751)).members).toHaveLength(750)
    expect(selectLaunchCohort(candidates(124))).toMatchObject({
      cap: 750,
      minimumEvidencePlayers: 125,
      selectedPlayers: 124,
      state: 'insufficient-evidence',
    })
    expect(selectLaunchCohort(candidates(125)).state).toBe('ready')
  })
})

function regionSnapshot(region: (typeof launchCohortRegions)[number], countPerBracket = 125) {
  const regionOffset = launchCohortRegions.indexOf(region) * 100_000
  return {
    snapshotId: `00000000-0000-4000-8000-${String(regionOffset + 1).padStart(12, '0')}`,
    generationId: '10000000-0000-4000-8000-000000000001',
    observedAt: '2026-08-10T00:00:00.000Z',
    region,
    mode: '1v1' as const,
    candidates: [
      ...Array.from({ length: countPerBracket }, (_, index) => ({
        brawlhallaId: regionOffset + index + 1,
        rating: 1680 + (index % 320),
      })),
      ...Array.from({ length: countPerBracket }, (_, index) => ({
        brawlhallaId: regionOffset + countPerBracket + index + 1,
        rating: 2000 + index,
      })),
    ],
  }
}

describe('full launch cohort selection', () => {
  test('represents exactly nine regions by two rating-derived brackets with an independent minimum in every cell', () => {
    const selected = selectFullLaunchCohort(launchCohortRegions.map((region) => regionSnapshot(region)))

    expect(selected.methodologyVersion).toBe(FULL_LAUNCH_COHORT_METHODOLOGY_VERSION)
    expect(selected.cells).toHaveLength(18)
    expect(selected.cells.map(({ region, bracket }) => `${region}:${bracket}`)).toEqual(
      launchCohortRegions.flatMap((region) => launchCohortBrackets.map((bracket) => `${region}:${bracket}`)),
    )
    expect(selected.cells.every((cell) => cell.selectedPlayers === 125 && cell.state === 'ready')).toBe(true)
    expect(selected.selectedPlayers).toBe(2_250)
    expect(selected.state).toBe('ready')
  })

  test('retains all 18 auditable cells when one cell misses 125 players', () => {
    const selected = selectFullLaunchCohort(
      launchCohortRegions.map((region) => regionSnapshot(region, region === 'ME' ? 124 : 125)),
    )

    expect(selected.cells).toHaveLength(18)
    expect(selected.cells.filter(({ state }) => state === 'insufficient-evidence')).toEqual([
      expect.objectContaining({ region: 'ME', bracket: 'Platinum', selectedPlayers: 124 }),
      expect.objectContaining({ region: 'ME', bracket: 'Diamond+', selectedPlayers: 124 }),
    ])
    expect(selected.state).toBe('insufficient-evidence')
  })

  test('rejects missing, duplicate, or cross-generation regional snapshots before selection', () => {
    const snapshots = launchCohortRegions.map((region) => regionSnapshot(region))
    expect(() => selectFullLaunchCohort(snapshots.slice(1))).toThrow('exactly nine regional snapshots')
    expect(() => selectFullLaunchCohort([...snapshots.slice(0, -1), regionSnapshot('EU')])).toThrow(
      'exactly one snapshot per launch region',
    )
    expect(() =>
      selectFullLaunchCohort([
        { ...snapshots[0], generationId: '10000000-0000-4000-8000-000000000002' },
        ...snapshots.slice(1),
      ]),
    ).toThrow('one immutable Ranking generation')
    expect(() =>
      selectFullLaunchCohort([
        {
          ...snapshots[0],
          candidates: [...snapshots[0].candidates, { ...snapshots[0].candidates[0], rating: 2000 }],
        },
        ...snapshots.slice(1),
      ]),
    ).toThrow('conflicting ratings')
  })

  test('bounds the declared capacity without changing the shared source quota', () => {
    const selected = selectFullLaunchCohort(launchCohortRegions.map((region) => regionSnapshot(region, 800)))

    expect(selected.cells.every(({ selectedPlayers }) => selectedPlayers === 750)).toBe(true)
    expect(selected.capacityEnvelope).toEqual({
      sourceDomain: 'brawlhalla-v1',
      quotaUnitsPerWindow: 150,
      quotaWindowSeconds: 900,
      requestsPerPlayer: 2,
      maxAttemptsPerRequest: 3,
      plannedRequests: 27_000,
      maximumSourceAttempts: 81_000,
      minimumCapacitySeconds: 486_000,
      observationWindowSeconds: 604_800,
    })
  })
})

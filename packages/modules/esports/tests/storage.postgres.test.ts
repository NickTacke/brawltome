import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { listEventsMissingSets } from '../db/list-events-missing-sets'
import { readStoredEsports } from '../db/read-stored-esports'
import { recordFailure } from '../db/record-failure'
import { saveEventSets } from '../db/save-event-sets'
import { type RefreshInput, saveRefresh } from '../db/save-refresh'
import { esportsModule } from '../index'
import { match, placement, powerRanking } from './domain/builders'

const brawlhallaId = 4242
const dayMs = 24 * 60 * 60 * 1000
const now = new Date('2026-11-23T12:00:00Z')

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'esports_storage', modules: [queueModule, playerModule, esportsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

beforeEach(async () => {
  await database.sql`TRUNCATE esports.players, esports.placements, esports.event_sets`
})

function linkedRefresh(overrides: Partial<RefreshInput> = {}): RefreshInput {
  return {
    brawlhallaId,
    link: 'linked',
    player: { playerId: 77, name: 'Ember', brawlhallaId },
    pr1v1: powerRanking({ earnings: 120, rank: 14, region: 'EU' }),
    pr2v2: null,
    placements: [placement()],
    eventLegends: [{ name: 'Mordex', count: 3 }],
    checkedAt: new Date('2026-11-20T00:00:00Z'),
    ...overrides,
  }
}

function daysBeforeNow(days: number): Date {
  return new Date(now.getTime() - days * dayMs)
}

describe('saveRefresh', () => {
  test('a refresh replaces old placements', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ tournamentId: 'old/1v1', tournamentName: 'Old Cup' }),
          placement({ tournamentId: 'kept/1v1', tournamentName: 'Kept Cup', placement: 9 }),
        ],
      }),
    )

    await saveRefresh(
      database,
      linkedRefresh({
        placements: [placement({ tournamentId: 'kept/1v1', tournamentName: 'Kept Cup', placement: 2 })],
      }),
    )

    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(stored.placements.map(({ tournamentId, placement: finish }) => [tournamentId, finish])).toEqual([
      ['kept/1v1', 2],
    ])

    expect(row).toMatchObject({
      link: 'linked',
      brawltoolsPlayerId: 77,
      brawltoolsName: 'Ember',
      eventLegends: [{ name: 'Mordex', count: 3 }],
      failureCount: 0,
    })

    expect(row?.lastSuccessAt).toEqual(new Date('2026-11-20T00:00:00Z'))
    expect(stored.pr1v1).toEqual(powerRanking({ earnings: 120, rank: 14, region: 'EU' }))
    expect(stored.pr2v2).toBeNull()
  })

  test('a refresh resets the failure count', async () => {
    await saveRefresh(database, linkedRefresh())
    await recordFailure(database, brawlhallaId, new Date('2026-11-21T00:00:00Z'))

    await saveRefresh(database, linkedRefresh({ checkedAt: new Date('2026-11-22T00:00:00Z') }))

    const { row } = await readStoredEsports(database, brawlhallaId)

    expect(row?.failureCount).toBe(0)
  })

  test('a none link keeps no placements', async () => {
    await saveRefresh(database, linkedRefresh())

    await saveRefresh(
      database,
      linkedRefresh({
        link: 'none',
        player: null,
        pr1v1: null,
        pr2v2: null,
        placements: [placement({ tournamentId: 'stray/1v1' })],
        eventLegends: [],
      }),
    )

    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(row).toMatchObject({ link: 'none', brawltoolsPlayerId: null, brawltoolsName: null, eventLegends: [] })
    expect(stored.placements).toEqual([])
    expect(stored.pr1v1).toBeNull()
  })

  test('a placement below 1 is skipped and the rest are saved', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ tournamentId: 'odd/1v1', placement: 0 }),
          placement({ tournamentId: 'negative/1v1', placement: -1 }),
          placement({ tournamentId: 'fine/1v1', placement: 3 }),
        ],
      }),
    )

    const { stored } = await readStoredEsports(database, brawlhallaId)

    expect(stored.placements.map(({ tournamentId }) => tournamentId)).toEqual(['fine/1v1'])
  })

  test('a repeated event keeps its best placement', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ tournamentId: 'cup/1v1', placement: 9 }),
          placement({ tournamentId: 'cup/1v1', placement: 3 }),
          placement({ tournamentId: 'cup/1v1', placement: 5 }),
          placement({ mode: 2, tournamentId: 'cup/1v1', placement: 6 }),
        ],
      }),
    )

    const { stored } = await readStoredEsports(database, brawlhallaId)

    expect(stored.placements.map(({ mode, placement: finish }) => [mode, finish])).toEqual([
      [1, 3],
      [2, 6],
    ])
  })

  test('both modes are kept and read back whole', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ mode: 1, tournamentId: 'cup/1v1' }),
          placement({ mode: 2, tournamentId: 'cup/2v2', placement: 7 }),
        ],
      }),
    )

    const { stored } = await readStoredEsports(database, brawlhallaId)

    expect(stored.placements).toEqual([
      placement({ mode: 1, tournamentId: 'cup/1v1' }),
      placement({ mode: 2, tournamentId: 'cup/2v2', placement: 7 }),
    ])
  })

  test('another player keeps their placements', async () => {
    await saveRefresh(
      database,
      linkedRefresh({ brawlhallaId: 9001, placements: [placement({ tournamentId: 'x/1v1' })] }),
    )

    await saveRefresh(database, linkedRefresh())

    const { stored } = await readStoredEsports(database, 9001)

    expect(stored.placements).toHaveLength(1)
  })
})

describe('recordFailure', () => {
  test('recordFailure counts up and keeps the stored data', async () => {
    await saveRefresh(database, linkedRefresh())

    await recordFailure(database, brawlhallaId, new Date('2026-11-21T00:00:00Z'))
    await recordFailure(database, brawlhallaId, new Date('2026-11-22T00:00:00Z'))

    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(row?.failureCount).toBe(2)
    expect(row?.checkedAt).toEqual(new Date('2026-11-22T00:00:00Z'))
    expect(row?.lastSuccessAt).toEqual(new Date('2026-11-20T00:00:00Z'))
    expect(row?.link).toBe('linked')
    expect(stored.placements).toHaveLength(1)
    expect(stored.pr1v1).not.toBeNull()
  })

  test('recordFailure creates a backing-off row for a player never stored', async () => {
    await recordFailure(database, brawlhallaId, new Date('2026-11-21T00:00:00Z'))

    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(row).toMatchObject({ link: 'none', failureCount: 1, eventLegends: [], lastSuccessAt: null })
    expect(row?.checkedAt).toEqual(new Date('2026-11-21T00:00:00Z'))
    expect(stored.placements).toEqual([])

    await recordFailure(database, brawlhallaId, new Date('2026-11-22T00:00:00Z'))

    const second = await readStoredEsports(database, brawlhallaId)

    expect(second.row?.failureCount).toBe(2)
  })
})

describe('saveEventSets and readStoredEsports', () => {
  test('sets are keyed by tournament and a second save replaces the first', async () => {
    const fetchedAt = new Date('2026-11-01T00:00:00Z')

    await saveEventSets(database, brawlhallaId, 'cup/1v1', [match({ matchId: 'a' })], fetchedAt)
    await saveEventSets(database, brawlhallaId, 'other/1v1', [match({ matchId: 'b' })], fetchedAt)

    await saveEventSets(database, brawlhallaId, 'cup/1v1', [match({ matchId: 'c' })], new Date('2026-11-02T00:00:00Z'))

    const { stored } = await readStoredEsports(database, brawlhallaId)

    expect([...stored.setsByTournament.keys()].sort()).toEqual(['cup/1v1', 'other/1v1'])
    expect(stored.setsByTournament.get('cup/1v1')).toEqual([match({ matchId: 'c' })])
  })

  test('a player never stored reads as empty', async () => {
    const { row, stored } = await readStoredEsports(database, brawlhallaId)

    expect(row).toBeNull()
    expect(stored).toEqual({ pr1v1: null, pr2v2: null, placements: [], setsByTournament: new Map() })
  })
})

describe('listEventsMissingSets', () => {
  test('listEventsMissingSets skips final events and returns young ones once they are final', async () => {
    await saveRefresh(
      database,
      linkedRefresh({
        placements: [
          placement({ tournamentId: 'never-fetched/1v1', startTime: daysBeforeNow(3) }),
          placement({ tournamentId: 'fetched-young-now-final/1v1', startTime: daysBeforeNow(10) }),
          placement({ tournamentId: 'fetched-young-still-young/1v1', startTime: daysBeforeNow(2) }),
          placement({ tournamentId: 'fetched-final-long-ago/1v1', startTime: daysBeforeNow(30) }),
          placement({ tournamentId: 'fetched-final-recently/1v1', startTime: daysBeforeNow(20) }),
          placement({ mode: 2, tournamentId: 'never-fetched/2v2', startTime: daysBeforeNow(40) }),
        ],
      }),
    )

    // 3 days after the start, so the sets may have been incomplete; the event is 10 days old now
    await saveEventSets(database, brawlhallaId, 'fetched-young-now-final/1v1', [], daysBeforeNow(7))
    // 1 day after the start, and the event is only 2 days old
    await saveEventSets(database, brawlhallaId, 'fetched-young-still-young/1v1', [], daysBeforeNow(1))
    // 8 days after the start, so already final
    await saveEventSets(database, brawlhallaId, 'fetched-final-long-ago/1v1', [], daysBeforeNow(22))
    // 15 days after the start, so already final
    await saveEventSets(database, brawlhallaId, 'fetched-final-recently/1v1', [], daysBeforeNow(5))

    const missing = await listEventsMissingSets(database, brawlhallaId, now)

    expect([...missing].sort()).toEqual(['fetched-young-now-final/1v1', 'never-fetched/1v1', 'never-fetched/2v2'])
  })

  test('another player is not listed', async () => {
    await saveRefresh(database, linkedRefresh({ brawlhallaId: 9001 }))

    expect(await listEventsMissingSets(database, brawlhallaId, now)).toEqual([])
  })
})

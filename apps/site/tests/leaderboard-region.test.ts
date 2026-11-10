import { describe, expect, test } from 'bun:test'
import { leaderboardForVisitor } from '../src/server/visitor-leaderboard'
import { stubFetch, useApiSettings } from './api-stub'
import { leaderboardBody } from './ranking-fixtures'

describe('leaderboardForVisitor', () => {
  useApiSettings()

  test('without a region in the address, shows the board remembered from Home', async () => {
    const urls = stubFetch(() => ({ status: 200, body: leaderboardBody({ page: 2, entryCount: 30, totalRows: 90 }) }))

    const answer = await leaderboardForVisitor({ mode: '1v1', page: 2 }, 'EU')

    expect(urls).toEqual(['/leaderboards/1v1/EU?page=2'])
    expect(answer.region).toBe('EU')
  })

  test('the region in the address wins over the remembered one', async () => {
    const urls = stubFetch(() => ({ status: 200, body: leaderboardBody({ page: 1, entryCount: 30, totalRows: 90 }) }))

    await leaderboardForVisitor({ mode: '2v2', region: 'JPN', page: 1 }, 'EU')

    expect(urls).toEqual(['/leaderboards/2v2/JPN?page=1'])
  })

  test('a failed read keeps the region, so the filters still show it', async () => {
    stubFetch(() => ({ status: 500, body: {} }))

    expect(await leaderboardForVisitor({ mode: '1v1', page: 1 }, 'SEA')).toEqual({ region: 'SEA', board: null })
  })
})

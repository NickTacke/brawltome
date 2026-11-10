import { describe, expect, test } from 'bun:test'
import { loadQueue } from '../src/server/load-queue'
import { stubFetch, useApiSettings } from './api-stub'
import { activityView, moversView, unavailableView } from './queue-fixtures'

const query = { mode: '2v2', region: 'US-E', page: 3 } as const

function answerBoth(activity: unknown, movers: unknown) {
  return stubFetch((url) => {
    if (url.includes('/recent-movers'))
      return movers === null ? { status: 503, body: {} } : { status: 200, body: movers }

    return { status: 200, body: activity }
  })
}

describe('loadQueue', () => {
  useApiSettings()

  test('reads the page and the movers of the chosen board', async () => {
    const urls = answerBoth(unavailableView('scan_gap'), unavailableView('scan_gap'))

    await loadQueue(query)

    expect(urls.sort()).toEqual([
      '/leaderboards/2v2/US-E/recent-activity?page=3',
      '/leaderboards/2v2/US-E/recent-movers',
    ])
  })

  test('returns the hour and its movers', async () => {
    answerBoth(activityView(3), moversView())

    const queue = await loadQueue(query)

    expect(queue.view).toEqual(activityView(3))
    expect(queue.movers).toEqual(moversView())
  })

  test('an hour that cannot be compared has no movers', async () => {
    answerBoth(unavailableView('not_enough_history'), {
      status: 'unavailable',
      reason: 'not_enough_history',
      mode: '1v1',
      region: 'EU',
    })

    const queue = await loadQueue(query)

    expect(queue.view).toEqual(unavailableView('not_enough_history'))
    expect(queue.movers).toBeNull()
  })

  test('failed movers still show the page, without the side column', async () => {
    answerBoth(activityView(3), null)

    const queue = await loadQueue(query)

    expect(queue.view).toEqual(activityView(3))
    expect(queue.movers).toBeNull()
  })

  test('movers from a newer scan than the table are left out, so the two never disagree', async () => {
    answerBoth(activityView(3), { ...moversView(), currentSnapshotId: '00000000-0000-4000-8000-000000000002' })

    const queue = await loadQueue(query)

    expect(queue.view).toEqual(activityView(3))
    expect(queue.movers).toBeNull()
  })

  test('a failed page read fails the page', async () => {
    stubFetch(() => ({ status: 503, body: {} }))

    expect(loadQueue(query)).rejects.toThrow('load the queue for 2v2 US-E page 3: api answered 503')
  })
})

import { describe, expect, test } from 'bun:test'
import { loadMostPlayedLegends } from '../src/server/load-most-played-legends'
import { stubFetch, useApiSettings } from './api-stub'

const legendKeys = ['mordex', 'diana', 'sidra', 'teros', 'ada', 'thor', 'hattori', 'orion', 'val', 'koji', 'ember']

function counts(keys: string[]) {
  const legends = keys.map((legendNameKey, index) => ({ legendNameKey, games: 100 - index, share: 0.05 }))

  return { season: 42, startsAt: '2026-09-23T14:00:00.000Z', playerCount: 300, legends }
}

describe('loadMostPlayedLegends', () => {
  useApiSettings()

  test('reads the counts for the current season', async () => {
    const urls = stubFetch(() => ({ status: 200, body: counts(legendKeys) }))

    await loadMostPlayedLegends()

    expect(urls).toEqual(['/legends/most-played'])
  })

  test('keeps the nine most played in the order the api gave', async () => {
    stubFetch(() => ({ status: 200, body: counts(legendKeys) }))

    const legends = await loadMostPlayedLegends()

    expect(legends.map(({ legendNameKey }) => legendNameKey)).toEqual(legendKeys.slice(0, 9))
  })

  test('a season nobody has been seen playing is empty', async () => {
    stubFetch(() => ({ status: 200, body: counts([]) }))

    expect(await loadMostPlayedLegends()).toEqual([])
  })

  test('no known season is empty', async () => {
    stubFetch(() => ({ status: 200, body: null }))

    expect(await loadMostPlayedLegends()).toEqual([])
  })

  test('a failed read is empty, so the page can still show', async () => {
    stubFetch(() => ({ status: 500, body: {} }))

    expect(await loadMostPlayedLegends()).toEqual([])
  })
})

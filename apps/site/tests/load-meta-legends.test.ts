import { describe, expect, test } from 'bun:test'
import { loadMetaLegends } from '../src/server/load-meta-legends'
import { stubFetch, useApiSettings } from './api-stub'

const legendKeys = ['diana', 'mordex', 'sidra', 'teros', 'ada', 'thor', 'hattori']

function meta(keys: string[]) {
  const legends = keys.map((legendNameKey, index) => ({
    legendNameKey,
    games: 5000 - index,
    playerCount: 140 - index,
    winRate: 0.55,
  }))

  return { season: 42, startsAt: '2026-09-23T14:00:00.000Z', legends }
}

describe('loadMetaLegends', () => {
  useApiSettings()

  test('reads the meta legends for the current season', async () => {
    const urls = stubFetch(() => ({ status: 200, body: meta(legendKeys) }))

    await loadMetaLegends()

    expect(urls).toEqual(['/legends/meta'])
  })

  test('keeps the five most played in the order the api gave', async () => {
    stubFetch(() => ({ status: 200, body: meta(legendKeys) }))

    const legends = await loadMetaLegends()

    expect(legends.map(({ legendNameKey }) => legendNameKey)).toEqual(legendKeys.slice(0, 5))
  })

  test('a season with no high rated players yet is empty', async () => {
    stubFetch(() => ({ status: 200, body: meta([]) }))

    expect(await loadMetaLegends()).toEqual([])
  })

  test('no known season is empty', async () => {
    stubFetch(() => ({ status: 200, body: null }))

    expect(await loadMetaLegends()).toEqual([])
  })

  test('a failed read is empty, so the page can still show', async () => {
    stubFetch(() => ({ status: 500, body: {} }))

    expect(await loadMetaLegends()).toEqual([])
  })
})

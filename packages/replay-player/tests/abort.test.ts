import { beforeAll, expect, test } from 'bun:test'
import { loadReplay } from '..'
import {
  artUrl,
  backgroundPiece,
  backgroundSheetPath,
  manifestUrl,
  queuedSheetPath,
  stubArtStore,
  stubImageBitmaps,
} from './art-store.ts'

beforeAll(stubImageBitmaps)

test('aborting while a background sheet loads stops the sheets still queued', async () => {
  const controller = new AbortController()

  // the page leaves while the background sheet is on its way
  const store = stubArtStore({
    onFetch: (url) => {
      if (url === `${artUrl}${backgroundSheetPath}`) controller.abort()
    },
  })

  const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch: store.fetch, signal: controller.signal })

  store.release()

  await expect(replay.loaded).rejects.toMatchObject({ name: 'AbortError' })
  expect(store.urls).toContain(`${artUrl}${backgroundSheetPath}`)
  expect(store.urls).not.toContain(`${artUrl}${queuedSheetPath}`)
  expect(replay.isLoaded(backgroundPiece)).toBe(false)
})

test('aborting before loadReplay resolves rejects it and fetches nothing more', async () => {
  const store = stubArtStore()
  const controller = new AbortController()

  // the page leaves while the manifest is on its way
  const fetch = async (url: string) => {
    const response = await store.fetch(url)

    if (url === manifestUrl) controller.abort()

    return response
  }

  await expect(loadReplay(manifestUrl, { baseUrl: artUrl, fetch, signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  })

  expect(store.urls).toEqual([manifestUrl])
})

test('loadReplay hands the signal to every fetch', async () => {
  const store = stubArtStore()
  const controller = new AbortController()
  const signals = new Set<AbortSignal | undefined>()

  const fetch = (url: string, init?: { signal?: AbortSignal }) => {
    signals.add(init?.signal)

    return store.fetch(url)
  }

  store.release()

  const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch, signal: controller.signal })

  await replay.loaded

  expect([...signals]).toEqual([controller.signal])
})

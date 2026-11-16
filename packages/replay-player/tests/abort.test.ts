import { beforeAll, expect, test } from 'bun:test'
import { loadReplay } from '..'
import { artUrl, backgroundSheetPath, manifestUrl, stubArtStore, stubImageBitmaps } from './art-store.ts'

beforeAll(stubImageBitmaps)

test('aborting after loadReplay resolves stops the background downloads', async () => {
  const store = stubArtStore()
  const controller = new AbortController()
  const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch: store.fetch, signal: controller.signal })

  controller.abort()
  store.release()

  await expect(replay.loaded).rejects.toMatchObject({ name: 'AbortError' })
  expect(store.urls).not.toContain(`${artUrl}${backgroundSheetPath}`)
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

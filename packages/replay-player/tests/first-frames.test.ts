import { beforeAll, expect, test } from 'bun:test'
import { isReady, loadReplay } from '..'
import {
  artUrl,
  backgroundPiece,
  backgroundSheetPath,
  manifestUrl,
  restAnimation,
  startAnimation,
  stubArtStore,
  stubImageBitmaps,
} from './art-store.ts'

beforeAll(stubImageBitmaps)

test('the first seconds can be drawn when loadReplay resolves, while the background sheet is pending', async () => {
  const store = stubArtStore()
  const replay = await loadReplay(manifestUrl, { baseUrl: artUrl, fetch: store.fetch })
  const player = replay.players.get('1')

  if (!player) throw new Error('expected player 1 in the replay')

  expect(isReady(replay, player, startAnimation)).toBe(true)
  expect(replay.isLoaded(backgroundPiece)).toBe(false)
  expect(isReady(replay, player, restAnimation)).toBe(false)

  store.release()
  await replay.loaded

  expect(store.urls).toContain(`${artUrl}${backgroundSheetPath}`)
  expect(isReady(replay, player, restAnimation)).toBe(true)
})

import { describe, expect, test } from 'bun:test'
import { createMemoryObjectStore } from '../testing'

describe('memory object store', () => {
  test('gives back what was put', async () => {
    const store = createMemoryObjectStore()

    await store.put('replays/a.replay', Uint8Array.of(1, 2, 3), 'application/octet-stream')

    expect(await store.get('replays/a.replay')).toEqual(Uint8Array.of(1, 2, 3))
    expect(store.keys()).toEqual(['replays/a.replay'])
  })

  test('answers null for a key it never had', async () => {
    const store = createMemoryObjectStore()

    expect(await store.get('replays/missing.replay')).toBeNull()
  })

  test('forgets a deleted key, and deleting twice is fine', async () => {
    const store = createMemoryObjectStore()

    await store.put('timelines/m/b.json.gz', Uint8Array.of(9), 'application/gzip')
    await store.delete('timelines/m/b.json.gz')
    await store.delete('timelines/m/b.json.gz')

    expect(await store.get('timelines/m/b.json.gz')).toBeNull()
    expect(store.keys()).toEqual([])
  })
})

import { describe, expect, test } from 'bun:test'
import { createImageCache } from '../src/server/image-cache'

function image(byteLength: number) {
  return { bytes: new Uint8Array(byteLength), contentType: 'image/jpeg' }
}

describe('createImageCache', () => {
  test('gives back what was stored', () => {
    const cache = createImageCache(100)
    const stored = image(10)

    cache.set('a', stored)

    expect(cache.get('a')).toBe(stored)
  })

  test('drops the least recently used image once the cap is passed', () => {
    const cache = createImageCache(100)

    cache.set('a', image(40))
    cache.set('b', image(40))
    cache.get('a')
    cache.set('c', image(40))

    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBeDefined()
  })

  test('does not count an image twice when it is stored again', () => {
    const cache = createImageCache(100)

    cache.set('a', image(60))
    cache.set('a', image(60))
    cache.set('b', image(40))

    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeDefined()
  })

  test('skips an image bigger than the whole cache', () => {
    const cache = createImageCache(100)

    cache.set('a', image(40))
    cache.set('huge', image(101))

    expect(cache.get('huge')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
  })
})

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { createImageCache } from '../src/server/image-cache'
import type { PatchNote } from '../src/server/patch-feed'
import { patchImageName } from '../src/server/patch-image-names'
import { createPatchImageProxy } from '../src/server/patch-image-proxy'

const originalFetch = globalThis.fetch

const smallUrl = 'https://cms.brawlhalla.com/c/uploads/teros-300.jpg'
const largeUrl = 'https://cms.brawlhalla.com/c/uploads/teros-768.jpg'
const foreignUrl = 'https://www.brawlhalla.com/c/uploads/teros-300.jpg'

type Upstream = { status?: number; contentType?: string; bytes?: Uint8Array<ArrayBuffer> }

function note(urls: string[]): PatchNote {
  return {
    headline: 'Ascended Teros',
    patch: 'Patch 11.00',
    publishedAt: '2026-10-13T17:36:01Z',
    url: 'https://brawlhalla.com/news/patch-1100',
    images: urls.map((url, index) => ({ width: 300 + index, url })),
  }
}

function stubUpstream(answer: (url: string) => Upstream = () => ({})) {
  const fetchImage = mock(async (input: string | URL | Request, _init?: RequestInit) => {
    const { status = 200, contentType = 'image/jpeg', bytes = new Uint8Array([1, 2, 3]) } = answer(String(input))

    return new Response(bytes, { status, headers: { 'content-type': contentType } })
  })

  globalThis.fetch = fetchImage as unknown as typeof fetch

  return fetchImage
}

function proxyFor(notes: PatchNote[] | null, maxCacheBytes = 1_000_000) {
  return createPatchImageProxy({ loadNotes: async () => notes, cache: createImageCache(maxCacheBytes) })
}

const feed = [note([smallUrl, largeUrl])]

describe('patch image proxy', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  test('serves an image from the feed with a long cache', async () => {
    const fetchImage = stubUpstream()
    const servePatchImage = proxyFor(feed)

    const response = await servePatchImage(patchImageName(largeUrl))

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(fetchImage.mock.calls.map(([url]) => String(url))).toEqual([largeUrl])
  })

  // a redirect could lead anywhere, so it counts as a failure
  test('does not follow redirects', async () => {
    const fetchImage = stubUpstream()

    await proxyFor(feed)(patchImageName(largeUrl))

    expect(fetchImage.mock.calls[0][1]?.redirect).toBe('error')
  })

  test('answers the second request from memory', async () => {
    const fetchImage = stubUpstream()
    const servePatchImage = proxyFor(feed)

    await servePatchImage(patchImageName(largeUrl))
    const response = await servePatchImage(patchImageName(largeUrl))

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  test('shares one fetch between requests that arrive together', async () => {
    const fetchImage = stubUpstream()
    const servePatchImage = proxyFor(feed)

    const responses = await Promise.all([
      servePatchImage(patchImageName(largeUrl)),
      servePatchImage(patchImageName(largeUrl)),
    ])

    expect(responses.map(({ status }) => status)).toEqual([200, 200])
    expect(fetchImage).toHaveBeenCalledTimes(1)
  })

  test('fetches an image again once the cache has dropped it', async () => {
    const fetchImage = stubUpstream(() => ({ bytes: new Uint8Array(600) }))
    const servePatchImage = proxyFor(feed, 1_000)

    await servePatchImage(patchImageName(smallUrl))
    await servePatchImage(patchImageName(largeUrl))
    await servePatchImage(patchImageName(smallUrl))

    expect(fetchImage.mock.calls.map(([url]) => String(url))).toEqual([smallUrl, largeUrl, smallUrl])
  })

  test('refuses a name that is not in the feed', async () => {
    const fetchImage = stubUpstream()

    const response = await proxyFor(feed)(patchImageName('https://cms.brawlhalla.com/c/uploads/other.jpg'))

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetchImage).not.toHaveBeenCalled()
  })

  test('refuses everything while the feed has never been read', async () => {
    const fetchImage = stubUpstream()

    const response = await proxyFor(null)(patchImageName(largeUrl))

    expect(response.status).toBe(404)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  test('never fetches from a host other than the cms, even when the feed names one', async () => {
    const fetchImage = stubUpstream()

    const response = await proxyFor([note([foreignUrl])])(patchImageName(foreignUrl))

    expect(response.status).toBe(404)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  const trickNames = [
    largeUrl,
    encodeURIComponent(largeUrl),
    '..',
    '../wp-json/wp/v2/users',
    '%2e%2e%2fwp-json',
    `${patchImageName(largeUrl)}/../other.jpg`,
    `${patchImageName(largeUrl)}%2F..%2Fother.jpg`,
    `${patchImageName(largeUrl)}?url=https://example.com`,
    `${patchImageName(largeUrl).toUpperCase()}`,
    '',
  ]

  for (const name of trickNames) {
    test(`refuses the name ${JSON.stringify(name)}`, async () => {
      const fetchImage = stubUpstream()

      const response = await proxyFor(feed)(name)

      expect(response.status).toBe(404)
      expect(fetchImage).not.toHaveBeenCalled()
    })
  }

  test('a failed fetch leaves the image missing and is tried again later', async () => {
    let status = 503
    const fetchImage = stubUpstream(() => ({ status }))
    const servePatchImage = proxyFor(feed)

    const failed = await servePatchImage(patchImageName(largeUrl))

    status = 200
    const retried = await servePatchImage(patchImageName(largeUrl))

    expect(failed.status).toBe(502)
    expect(failed.headers.get('cache-control')).toBe('no-store')
    expect(retried.status).toBe(200)
    expect(fetchImage).toHaveBeenCalledTimes(2)
  })

  test('a fetch that throws leaves the image missing', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('connection reset')
    }) as unknown as typeof fetch

    const response = await proxyFor(feed)(patchImageName(largeUrl))

    expect(response.status).toBe(502)
  })

  // the answer is served from our own origin, so markup or svg could run script there
  for (const contentType of ['text/html', 'image/svg+xml', '']) {
    test(`refuses an answer of type ${JSON.stringify(contentType)}`, async () => {
      stubUpstream(() => ({ contentType }))

      const response = await proxyFor(feed)(patchImageName(largeUrl))

      expect(response.status).toBe(502)
    })
  }

  test('refuses an image bigger than the size limit', async () => {
    stubUpstream(() => ({ bytes: new Uint8Array(3_000_000) }))

    const response = await proxyFor(feed)(patchImageName(largeUrl))

    expect(response.status).toBe(502)
  })
})

import { type CachedImage, createImageCache, type ImageCache } from './image-cache'
import { loadPatches } from './load-patches'
import { failureText } from './optional-read'
import type { PatchNote } from './patch-feed'
import { findPatchImageSource } from './patch-image-names'

type ProxyOptions = {
  loadNotes: () => Promise<PatchNote[] | null>
  cache: ImageCache
}

const cmsOrigin = 'https://cms.brawlhalla.com'
const imageTimeoutMs = 5_000

// the 768px art is about 100 KB, so this only stops something that is clearly not patch art
const maxImageBytes = 2_000_000

// a few releases' worth of art, small next to the container's memory
const maxCacheBytes = 16_000_000

// svg is left out on purpose, it is served from our own origin and could carry script
const rasterTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

// the name is a hash of the cms url, so the bytes behind it never change
const immutableCacheControl = 'public, max-age=31536000, immutable'

function isCmsUrl(sourceUrl: string): boolean {
  return URL.canParse(sourceUrl) && new URL(sourceUrl).origin === cmsOrigin
}

function missingImage(status: number): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } })
}

function imageResponse(image: CachedImage): Response {
  const headers = {
    'content-type': image.contentType,
    'cache-control': immutableCacheControl,
    'x-content-type-options': 'nosniff',
  }

  return new Response(image.bytes, { headers })
}

async function fetchImage(sourceUrl: string): Promise<CachedImage> {
  // a redirect could lead anywhere, so it counts as a failure
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(imageTimeoutMs), redirect: 'error' })

  if (!response.ok) throw new Error(`fetch patch image ${sourceUrl}: cms answered ${response.status}`)

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''

  if (!rasterTypes.has(contentType)) throw new Error(`fetch patch image ${sourceUrl}: cms sent "${contentType}"`)

  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.byteLength > maxImageBytes) throw new Error(`fetch patch image ${sourceUrl}: ${bytes.byteLength} bytes`)

  return { bytes, contentType }
}

/**
 * Serves the feed's patch art from BrawlTome. Only urls on the cms that the feed currently names are fetched, so a
 * visitor can't make the site ask anything else.
 */
export function createPatchImageProxy({ loadNotes, cache }: ProxyOptions) {
  const pendingFetches = new Map<string, Promise<CachedImage | null>>()

  async function fetchIntoCache(name: string, sourceUrl: string): Promise<CachedImage | null> {
    try {
      const image = await fetchImage(sourceUrl)

      cache.set(name, image)

      return image
    } catch (error) {
      console.error(failureText(error))

      return null
    }
  }

  function sharedFetch(name: string, sourceUrl: string): Promise<CachedImage | null> {
    const pending = pendingFetches.get(name)

    if (pending) return pending

    const started = fetchIntoCache(name, sourceUrl).finally(() => pendingFetches.delete(name))

    pendingFetches.set(name, started)

    return started
  }

  return async function servePatchImage(name: string): Promise<Response> {
    const notes = await loadNotes()
    const sourceUrl = notes ? findPatchImageSource(notes, name) : null

    if (!sourceUrl || !isCmsUrl(sourceUrl)) return missingImage(404)

    const image = cache.get(name) ?? (await sharedFetch(name, sourceUrl))

    if (!image) return missingImage(502)

    return imageResponse(image)
  }
}

export const servePatchImage = createPatchImageProxy({ loadNotes: loadPatches, cache: createImageCache(maxCacheBytes) })

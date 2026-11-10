export type CachedImage = { bytes: Uint8Array<ArrayBuffer>; contentType: string }

export type ImageCache = {
  get: (key: string) => CachedImage | undefined
  set: (key: string, image: CachedImage) => void
}

/** Keeps images in memory up to `maxBytes` in total, dropping the least recently used first. */
export function createImageCache(maxBytes: number): ImageCache {
  // a map iterates in insertion order, so the first entry is always the least recently used
  const images = new Map<string, CachedImage>()
  let totalBytes = 0

  function remove(key: string): void {
    const image = images.get(key)

    if (!image) return

    images.delete(key)
    totalBytes -= image.bytes.byteLength
  }

  function get(key: string): CachedImage | undefined {
    const image = images.get(key)

    if (!image) return undefined

    images.delete(key)
    images.set(key, image)

    return image
  }

  function set(key: string, image: CachedImage): void {
    if (image.bytes.byteLength > maxBytes) return

    remove(key)
    images.set(key, image)
    totalBytes += image.bytes.byteLength

    for (const oldestKey of images.keys()) {
      if (totalBytes <= maxBytes) break

      remove(oldestKey)
    }
  }

  return { get, set }
}

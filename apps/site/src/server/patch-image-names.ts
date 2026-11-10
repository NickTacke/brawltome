import { createHash } from 'node:crypto'
import type { PatchNote } from './patch-feed'

const patchImagePathPrefix = '/patch-images/'

// 64 bits is plenty for the handful of images in the feed
const nameLength = 16

/** A fixed name for a cms image, so the path holds nothing a visitor could turn into another url. */
export function patchImageName(sourceUrl: string): string {
  return createHash('sha256').update(sourceUrl).digest('hex').slice(0, nameLength)
}

/** The notes with every image pointed at BrawlTome, so the visitor's browser never contacts the cms. */
export function servedFromBrawlTome(notes: PatchNote[]): PatchNote[] {
  return notes.map((note) => ({
    ...note,
    images: note.images.map((image) => ({ ...image, url: `${patchImagePathPrefix}${patchImageName(image.url)}` })),
  }))
}

/** The cms url behind `name`, or null when no image in the notes has that name. */
export function findPatchImageSource(notes: PatchNote[], name: string): string | null {
  const sourceUrls = notes.flatMap((note) => note.images.map((image) => image.url))

  return sourceUrls.find((sourceUrl) => patchImageName(sourceUrl) === name) ?? null
}

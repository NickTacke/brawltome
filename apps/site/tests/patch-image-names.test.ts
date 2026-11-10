import { describe, expect, test } from 'bun:test'
import type { PatchNote } from '../src/server/patch-feed'
import { findPatchImageSource, patchImageName, servedFromBrawlTome } from '../src/server/patch-image-names'

const smallUrl = 'https://cms.brawlhalla.com/c/uploads/teros-300.jpg'
const largeUrl = 'https://cms.brawlhalla.com/c/uploads/teros-768.jpg'

const note: PatchNote = {
  headline: 'Ascended Teros',
  patch: 'Patch 11.00',
  publishedAt: '2026-10-13T17:36:01Z',
  url: 'https://brawlhalla.com/news/patch-1100',
  images: [
    { width: 300, url: smallUrl },
    { width: 768, url: largeUrl },
  ],
}

describe('patchImageName', () => {
  test('gives the same url the same name every time', () => {
    expect(patchImageName(smallUrl)).toBe(patchImageName(smallUrl))
  })

  test('gives different urls different names', () => {
    expect(patchImageName(smallUrl)).not.toBe(patchImageName(largeUrl))
  })

  test('is plain hex, so nothing of the url shows in the path', () => {
    expect(patchImageName(smallUrl)).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('servedFromBrawlTome', () => {
  test('points every size at a brawltome path and keeps its width', () => {
    const [served] = servedFromBrawlTome([note])

    expect(served.images).toEqual([
      { width: 300, url: `/patch-images/${patchImageName(smallUrl)}` },
      { width: 768, url: `/patch-images/${patchImageName(largeUrl)}` },
    ])
  })

  test('keeps the rest of the note', () => {
    const [served] = servedFromBrawlTome([note])

    expect({ ...served, images: note.images }).toEqual(note)
  })
})

describe('findPatchImageSource', () => {
  test('finds the cms url behind a name', () => {
    expect(findPatchImageSource([note], patchImageName(largeUrl))).toBe(largeUrl)
  })

  test('knows nothing about a name outside the notes', () => {
    expect(findPatchImageSource([note], patchImageName('https://cms.brawlhalla.com/wp-json/wp/v2/users'))).toBeNull()
  })

  test('does not take a url as a name', () => {
    expect(findPatchImageSource([note], largeUrl)).toBeNull()
  })
})

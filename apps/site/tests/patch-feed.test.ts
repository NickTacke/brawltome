import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { readPatchFeed, splitPatchTitle } from '../src/server/patch-feed'
import { type StubAnswer, stubFetch } from './api-stub'

const originalFetch = globalThis.fetch

function media(fileName: string) {
  const sized = (width: number) => ({
    width,
    height: Math.round(width * 0.5625),
    source_url: `https://cms.brawlhalla.com/c/uploads/${fileName}-${width}.jpg`,
  })

  return {
    source_url: `https://cms.brawlhalla.com/c/uploads/${fileName}.jpg`,
    media_details: {
      sizes: { thumbnail: sized(150), medium: sized(300), medium_large: sized(768), full: sized(1920) },
    },
  }
}

function post(title: string, link = 'https://brawlhalla.com/news/patch-1100') {
  return {
    date_gmt: '2026-10-13T17:36:01',
    link,
    title: { rendered: title },
    _embedded: { 'wp:featuredmedia': [media('teros')] },
  }
}

function answerWith(answer: StubAnswer) {
  return stubFetch(() => answer)
}

describe('splitPatchTitle', () => {
  test('puts the patch number beside the headline', () => {
    expect(splitPatchTitle('Battle Pass Season 14 – Patch 10.11')).toEqual({
      headline: 'Battle Pass Season 14',
      patch: 'Patch 10.11',
    })
  })

  test('a title without a patch number is all headline', () => {
    expect(splitPatchTitle('Brawlhalla World Championship')).toEqual({
      headline: 'Brawlhalla World Championship',
      patch: null,
    })
  })
})

describe('readPatchFeed', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  test('asks the cms for the latest three patch posts', async () => {
    const urls = answerWith({ status: 200, body: [post('Patch')] })

    await readPatchFeed()

    const url = new URL(urls[0])

    expect(url.origin + url.pathname).toBe('https://cms.brawlhalla.com/wp-json/wp/v2/posts')
    expect(url.searchParams.get('categories')).toBe('15')
    expect(url.searchParams.get('per_page')).toBe('3')
  })

  test('decodes the title and keeps the link, date and a small image', async () => {
    answerWith({ status: 200, body: [post('Ascended Teros &#038; 11th Anniversary Event – Patch 11.00')] })

    const [note] = await readPatchFeed()

    expect(note).toEqual({
      headline: 'Ascended Teros & 11th Anniversary Event',
      patch: 'Patch 11.00',
      publishedAt: '2026-10-13T17:36:01Z',
      url: 'https://brawlhalla.com/news/patch-1100',
      images: [
        { width: 300, url: 'https://cms.brawlhalla.com/c/uploads/teros-300.jpg' },
        { width: 768, url: 'https://cms.brawlhalla.com/c/uploads/teros-768.jpg' },
      ],
    })
  })

  test('a post without art keeps its text', async () => {
    const { _embedded, ...withoutArt } = post('Patch 10.10')

    answerWith({ status: 200, body: [withoutArt] })

    const [note] = await readPatchFeed()

    expect(note.images).toEqual([])
  })

  // the site fetches the art itself, so it only ever asks the cms
  test('drops art hosted anywhere but cms.brawlhalla.com', async () => {
    const withForeignArt = post('Patch 10.10')
    const [art] = withForeignArt._embedded['wp:featuredmedia']

    art.media_details.sizes.medium.source_url = 'https://www.brawlhalla.com/c/uploads/teros-300.jpg'
    answerWith({ status: 200, body: [withForeignArt] })

    const [note] = await readPatchFeed()

    expect(note.images.map(({ width }) => width)).toEqual([768])
  })

  // the link ends up in an href, so a javascript: or foreign url must never get through
  test('drops a post whose link leaves brawlhalla.com', async () => {
    answerWith({ status: 200, body: [post('Bad', 'javascript:alert(1)'), post('Good')] })

    const notes = await readPatchFeed()

    expect(notes.map(({ headline }) => headline)).toEqual(['Good'])
  })

  test('a failed feed throws', async () => {
    answerWith({ status: 502, body: {} })

    await expect(readPatchFeed()).rejects.toThrow('read patch notes: cms answered 502')
  })

  test('a feed with nothing usable throws', async () => {
    answerWith({ status: 200, body: { code: 'rest_invalid_param' } })

    await expect(readPatchFeed()).rejects.toThrow('read patch notes: cms answered no usable posts')
  })
})

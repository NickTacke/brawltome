import { z } from 'zod'

export type PatchImageSize = { width: number; url: string }

export type PatchNote = {
  headline: string
  patch: string | null
  publishedAt: string
  url: string
  // smallest first, empty when the post has no art
  images: PatchImageSize[]
}

const feedUrl = new URL('https://cms.brawlhalla.com/wp-json/wp/v2/posts')

feedUrl.search = new URLSearchParams({
  categories: '15',
  per_page: '3',
  _embed: 'wp:featuredmedia',
  // without the post bodies the answer is about 30 KB instead of 150 KB
  _fields: 'date_gmt,link,title,_links.wp:featuredmedia,_embedded',
}).toString()

const feedTimeoutMs = 5_000

// the cards are at most about 450px wide, so anything past 768px is wasted bytes
const imageWidths = [300, 768]

// links and images end up in href and src, so only https on brawlhalla.com gets through
const brawlhallaUrl = z.url({ protocol: /^https$/, hostname: /(^|\.)brawlhalla\.com$/ })

// the site fetches the art for the visitor, so only the cms itself gets asked
const cmsUrl = z.url({ protocol: /^https$/, hostname: /^cms\.brawlhalla\.com$/ })

const imageSizeSchema = z.object({ width: z.number(), source_url: cmsUrl })

const mediaSchema = z.object({
  media_details: z.object({ sizes: z.record(z.string(), z.unknown()) }),
})

const postSchema = z.object({
  date_gmt: z.iso.datetime({ local: true }),
  link: brawlhallaUrl,
  title: z.object({ rendered: z.string().min(1) }),
  _embedded: z.object({ 'wp:featuredmedia': z.array(z.unknown()) }).optional(),
})

const namedEntities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

// wordpress sends titles as html, react would show the entities as typed
function decodeEntities(html: string): string {
  return html.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16))

    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)))

    return namedEntities[name.toLowerCase()] ?? entity
  })
}

/** Splits "Battle Pass Season 14 – Patch 10.11" so the patch number can sit beside the date. */
export function splitPatchTitle(title: string): { headline: string; patch: string | null } {
  const [headline, patch] = title.split(/\s+[–-]\s+(?=Patch\s)/)

  return { headline, patch: patch ?? null }
}

function pickImages(embedded: unknown[] | undefined): PatchImageSize[] {
  const media = mediaSchema.safeParse(embedded?.[0])

  if (!media.success) return []

  const sizes = Object.values(media.data.media_details.sizes).flatMap((size) => {
    const parsedSize = imageSizeSchema.safeParse(size)

    if (!parsedSize.success || !imageWidths.includes(parsedSize.data.width)) return []

    return [{ width: parsedSize.data.width, url: parsedSize.data.source_url }]
  })

  return sizes.sort((left, right) => left.width - right.width)
}

function toPatchNote(post: unknown): PatchNote[] {
  const parsedPost = postSchema.safeParse(post)

  if (!parsedPost.success) return []

  const { date_gmt, link, title, _embedded } = parsedPost.data
  const { headline, patch } = splitPatchTitle(decodeEntities(title.rendered))

  return [
    { headline, patch, publishedAt: `${date_gmt}Z`, url: link, images: pickImages(_embedded?.['wp:featuredmedia']) },
  ]
}

/** The latest patch notes from Brawlhalla's news site. Throws when the feed can't be read. */
export async function readPatchFeed(): Promise<PatchNote[]> {
  const response = await fetch(feedUrl, { signal: AbortSignal.timeout(feedTimeoutMs) })

  if (!response.ok) throw new Error(`read patch notes: cms answered ${response.status}`)

  const posts: unknown = await response.json()
  const notes = Array.isArray(posts) ? posts.flatMap(toPatchNote) : []

  if (notes.length === 0) throw new Error('read patch notes: cms answered no usable posts')

  return notes
}

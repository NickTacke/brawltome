import { z } from 'zod'

export type PatchImage = { source: string; sourceSet: string }

export type PatchNote = {
  headline: string
  patch: string | null
  publishedAt: string
  url: string
  image: PatchImage | null
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

const imageSizeSchema = z.object({ width: z.number(), source_url: brawlhallaUrl })

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

function pickImage(embedded: unknown[] | undefined): PatchImage | null {
  const media = mediaSchema.safeParse(embedded?.[0])

  if (!media.success) return null

  const sizes = Object.values(media.data.media_details.sizes).flatMap((size) => {
    const parsedSize = imageSizeSchema.safeParse(size)

    return parsedSize.success && imageWidths.includes(parsedSize.data.width) ? [parsedSize.data] : []
  })

  if (sizes.length === 0) return null

  sizes.sort((left, right) => left.width - right.width)

  return {
    source: sizes[sizes.length - 1].source_url,
    sourceSet: sizes.map((size) => `${size.source_url} ${size.width}w`).join(', '),
  }
}

function toPatchNote(post: unknown): PatchNote[] {
  const parsedPost = postSchema.safeParse(post)

  if (!parsedPost.success) return []

  const { date_gmt, link, title, _embedded } = parsedPost.data
  const { headline, patch } = splitPatchTitle(decodeEntities(title.rendered))

  return [
    { headline, patch, publishedAt: `${date_gmt}Z`, url: link, image: pickImage(_embedded?.['wp:featuredmedia']) },
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

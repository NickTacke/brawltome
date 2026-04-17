import type { MatchRow } from '../match'
import type { Cursor, MatchRepo } from '../match.repo'

export type { Cursor } from '../match.repo'

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ u: c.uploadedAt.toISOString(), s: c.slug })).toString(
    'base64url',
  )
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const j = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { u: string; s: string }
    return { uploadedAt: new Date(j.u), slug: j.s }
  } catch {
    return null
  }
}

export async function matchHistory(
  deps: { matchRepo: Pick<MatchRepo, 'listByPlayer'> },
  input: { brawlhallaId: number; cursor: Cursor | null; limit: number },
): Promise<{ matches: MatchRow[]; nextCursor: Cursor | null }> {
  const limit = Math.max(1, Math.min(100, input.limit))
  const rows = await deps.matchRepo.listByPlayer(input.brawlhallaId, input.cursor, limit + 1)
  const hasMore = rows.length > limit
  const matches = hasMore ? rows.slice(0, limit) : rows
  const last = matches[matches.length - 1]
  const nextCursor = hasMore && last ? { uploadedAt: last.uploadedAt, slug: last.slug } : null
  return { matches, nextCursor }
}

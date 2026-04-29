import type { PlayerRepo } from '@brawltome/player'
import { type Bracket, type PageEntry, type PageResponse, fetchLeaderboardPage } from './leaderboard-endpoint'
import { type TierFallbackKind, normalizeRegion, resolveTier } from './sweep-helpers'

export interface SweepBracketDeps {
  bracket: Bracket
  repo: PlayerRepo
  fetchPage?: (opts: { bracket: Bracket; page: number }) => Promise<PageResponse>
  concurrency?: number
  onTierFallback?: (kind: Exclude<TierFallbackKind, 'none'>) => void
}

export interface SweepBracketResult {
  pagesOk: number
  pagesSkipped: number
  pagesFailed: number
  rowsWritten: number
  durationMs: number
}

const DEFAULT_CONCURRENCY = 20

export async function sweepBracket(deps: SweepBracketDeps): Promise<SweepBracketResult> {
  const fetchPage = deps.fetchPage ?? fetchLeaderboardPage
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const onTierFallback = deps.onTierFallback ?? (() => {})

  const start = performance.now()
  let pagesOk = 0
  let pagesSkipped = 0
  let pagesFailed = 0
  let rowsWritten = 0

  let firstPage: PageResponse
  try {
    firstPage = await fetchPage({ bracket: deps.bracket, page: 1 })
  } catch (err) {
    console.error(`[sweep] ${deps.bracket}: failed to fetch page 1:`, err)
    pagesSkipped++
    return { pagesOk, pagesSkipped, pagesFailed, rowsWritten, durationMs: performance.now() - start }
  }
  const totalPages = firstPage.total_pages
  try {
    const written = await writePage(deps.bracket, firstPage.rankings, deps.repo, onTierFallback)
    pagesOk++
    rowsWritten += written
  } catch (err) {
    console.error(`[sweep] ${deps.bracket} page 1 write failed:`, err)
    pagesFailed++
  }

  const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2)
  // Workers race on cursor++. Safe because JS is single-threaded and cursor++
  // happens between awaits, so no two workers can read the same idx. Adding any
  // await between cursor++ and pageNumbers[idx] would break this.
  let cursor = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = cursor++
        if (idx >= pageNumbers.length) return
        const page = pageNumbers[idx]
        let res: PageResponse
        try {
          res = await fetchPage({ bracket: deps.bracket, page })
        } catch (err) {
          console.error(`[sweep] ${deps.bracket} page ${page} fetch skipped:`, err)
          pagesSkipped++
          continue
        }
        try {
          const w = await writePage(deps.bracket, res.rankings, deps.repo, onTierFallback)
          pagesOk++
          rowsWritten += w
        } catch (err) {
          console.error(`[sweep] ${deps.bracket} page ${page} write failed:`, err)
          pagesFailed++
        }
      }
    }),
  )

  return { pagesOk, pagesSkipped, pagesFailed, rowsWritten, durationMs: performance.now() - start }
}

async function writePage(
  bracket: Bracket,
  entries: PageEntry[],
  repo: PlayerRepo,
  onTierFallback: (kind: Exclude<TierFallbackKind, 'none'>) => void,
): Promise<number> {
  if (entries.length === 0) return 0
  if (bracket === '1v1' || bracket === '3v3') {
    type SoloRow = {
      brawlhallaId: number
      name: string
      region: string
      rating: number
      peakRating: number
      tier: string
      wins: number
      losses: number
    }
    const rows: SoloRow[] = []
    for (const e of entries) {
      const id = e.id ?? e.players?.[0]?.id
      if (id === undefined) {
        console.warn(`[sweep] ${bracket} skipping entry with no id:`, JSON.stringify(e))
        continue
      }
      const name = e.username ?? e.players?.[0]?.username ?? `Player ${id}`
      const region = normalizeRegion(e.region ?? '')
      const { tier, fallback } = resolveTier({ apiTier: e.tier, bestRating: e.best_rating })
      if (fallback !== 'none') onTierFallback(fallback)
      rows.push({
        brawlhallaId: id,
        name,
        region,
        rating: e.rating,
        peakRating: e.best_rating,
        tier,
        wins: e.wins,
        losses: e.losses,
      })
    }
    if (bracket === '1v1') await repo.sweepUpsert1v1(rows)
    else await repo.sweepUpsert3v3(rows)
    return rows.length
  }

  if (bracket === '2v2') {
    const teams = entries
      .filter((e) => e.players && e.players.length === 2)
      .map((e) => {
        const region = normalizeRegion(e.region ?? '')
        const { tier, fallback } = resolveTier({ apiTier: e.tier, bestRating: e.best_rating })
        if (fallback !== 'none') onTierFallback(fallback)
        return {
          brawlhallaIdOne: e.players![0].id,
          brawlhallaIdTwo: e.players![1].id,
          teamName: '',
          rating: e.rating,
          peakRating: e.best_rating,
          tier,
          wins: e.wins,
          losses: e.losses,
          region,
        }
      })
    await repo.sweepUpsert2v2(teams)
    return teams.length
  }

  const rows = entries
    .filter((e) => e.players && e.players.length === 1)
    .map((e) => {
      const region = normalizeRegion(e.region ?? '')
      const { tier, fallback } = resolveTier({ apiTier: e.tier, bestRating: e.best_rating })
      if (fallback !== 'none') onTierFallback(fallback)
      const p = e.players![0]
      return {
        brawlhallaId: p.id,
        name: p.username,
        teamName: '',
        rating: e.rating,
        peakRating: e.best_rating,
        tier,
        wins: e.wins,
        losses: e.losses,
        region,
      }
    })
  await repo.sweepUpsertSolo2v2(rows)
  return rows.length
}

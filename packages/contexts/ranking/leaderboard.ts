import { type RegionalLeaderboardScope, regionalLeaderboardScopes } from './v1-leaderboard-source'
import type { SourceLeaderboardPage } from './v1-leaderboard-source'

export const defaultLeaderboardPageDepth = 1
export const maxLeaderboardPageDepth = 20
export const defaultLeaderboardIntervalMs = 15 * 60 * 1000

export type LeaderboardScope = 'all' | RegionalLeaderboardScope

export type PublishedLeaderboardRow = {
  standing: number
  sourceRank: number
  brawlhallaId: number
  name: string
  region: RegionalLeaderboardScope
  rating: number
  peakRating: number
  wins: number
  losses: number
  tier: string | null
}

export type LeaderboardGenerationCandidate = {
  operationKey: string
  observedAt: Date
  scheduleWindowAt: Date
  expectedNextPublicationAt: Date
  pageDepth: number
  snapshots: ReadonlyMap<LeaderboardScope, readonly PublishedLeaderboardRow[]>
}

export type RankingPublicationAuthorization = {
  operationId: string
  operationKey: string
  leaseOwner: string
  leaseToken: number
  scheduleWindowAt: string | null
}

export type PublicationResult = 'published' | 'already-published' | 'effect-conflict' | 'lease-lost'

export type Leaderboard1v1View =
  | {
      status: 'fresh' | 'stale'
      snapshotId: string
      generationId: string
      region: LeaderboardScope
      observedAt: string
      publishedAt: string
      expectedNextPublicationAt: string
      provenance: {
        source: 'brawlhalla-v1-ranked-leaderboard'
        contractVersion: 1
        pageDepth: number
      }
      page: number
      pageSize: number
      hasMore: boolean
      totalRows: number
      entries: Array<Omit<PublishedLeaderboardRow, 'peakRating'> & { peakRating: number | null; games: number }>
    }
  | {
      status: 'unavailable'
      reason: 'not_yet_published' | 'snapshot_not_found'
      page: number
      pageSize: number
    }

export type RankingQueries = {
  get1v1(input: {
    region: LeaderboardScope
    page: number
    pageSize?: number
    snapshotId?: string
    now?: Date
  }): Promise<Leaderboard1v1View>
}

export type RankingPublicationStore = {
  publish1v1Generation(
    authorization: RankingPublicationAuthorization,
    candidate: LeaderboardGenerationCandidate,
  ): Promise<PublicationResult>
  record1v1CollectionFailure(
    authorization: RankingPublicationAuthorization,
    failure: { checkedAt: Date; code: string; message: string },
  ): Promise<'recorded' | 'lease-lost'>
}

export type LeaderboardPageSource = {
  fetchPage(input: { region: RegionalLeaderboardScope; page: number }): Promise<SourceLeaderboardPage>
}

export class LeaderboardCandidateError extends Error {
  readonly code = 'leaderboard_candidate_invalid'
  readonly retryable = false

  constructor(message: string) {
    super(message)
    this.name = 'LeaderboardCandidateError'
  }
}

export class LeaderboardLeaseLostError extends Error {
  readonly code = 'leaderboard_lease_lost'
  readonly retryable = true

  constructor() {
    super('Leaderboard publication lease was lost')
    this.name = 'LeaderboardLeaseLostError'
  }
}

export class LeaderboardEffectConflictError extends Error {
  readonly code = 'leaderboard_effect_conflict'
  readonly retryable = false

  constructor() {
    super('Leaderboard operation key belongs to a different durable effect')
    this.name = 'LeaderboardEffectConflictError'
  }
}

function validateDepth(depth: number): void {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > maxLeaderboardPageDepth) {
    throw new LeaderboardCandidateError(`page depth must be between 1 and ${maxLeaderboardPageDepth}`)
  }
}

function validateRegionRows(region: RegionalLeaderboardScope, pages: readonly SourceLeaderboardPage[], depth: number) {
  if (pages.length !== depth) throw new LeaderboardCandidateError(`${region} candidate is incomplete`)
  const totalPages = pages[0]?.totalPages
  if (!totalPages || totalPages < depth) {
    throw new LeaderboardCandidateError(`${region} does not contain configured page depth ${depth}`)
  }
  const ids = new Set<number>()
  const ranks = new Set<number>()
  const rows: PublishedLeaderboardRow[] = []
  let priorRank = 0
  for (const [pageIndex, page] of pages.entries()) {
    if (page.totalPages !== totalPages) {
      throw new LeaderboardCandidateError(`${region} total_pages changed during collection`)
    }
    const isSourceTerminal = pageIndex + 1 === totalPages
    if (!isSourceTerminal && page.rankings.length !== 50) {
      throw new LeaderboardCandidateError(`${region} page ${pageIndex + 1} is incomplete`)
    }
    if (page.rankings.length === 0) throw new LeaderboardCandidateError(`${region} page ${pageIndex + 1} is empty`)
    for (const row of page.rankings) {
      if (ids.has(row.id)) throw new LeaderboardCandidateError(`${region} contains duplicate player ${row.id}`)
      if (ranks.has(row.rank))
        throw new LeaderboardCandidateError(`${region} contains duplicate source rank ${row.rank}`)
      if (row.rank <= priorRank)
        throw new LeaderboardCandidateError(`${region} source ranks are not strictly increasing`)
      ids.add(row.id)
      ranks.add(row.rank)
      priorRank = row.rank
      rows.push({
        standing: row.rank,
        sourceRank: row.rank,
        brawlhallaId: row.id,
        name: row.username,
        region: row.region,
        rating: row.rating,
        peakRating: row.best_rating,
        wins: row.wins,
        losses: row.losses,
        tier: row.tier,
      })
    }
  }
  return rows
}

const regionOrder = new Map(regionalLeaderboardScopes.map((region, index) => [region, index]))

function compareGlobalRows(left: PublishedLeaderboardRow, right: PublishedLeaderboardRow): number {
  return (
    right.rating - left.rating ||
    right.peakRating - left.peakRating ||
    right.wins - left.wins ||
    left.losses - right.losses ||
    left.sourceRank - right.sourceRank ||
    (regionOrder.get(left.region) ?? 0) - (regionOrder.get(right.region) ?? 0) ||
    left.brawlhallaId - right.brawlhallaId ||
    left.name.localeCompare(right.name)
  )
}

function buildGlobal(regional: ReadonlyMap<RegionalLeaderboardScope, readonly PublishedLeaderboardRow[]>) {
  const strongest = new Map<number, PublishedLeaderboardRow>()
  for (const region of regionalLeaderboardScopes) {
    const rows = regional.get(region)
    if (!rows) throw new LeaderboardCandidateError(`missing regional candidate ${region}`)
    for (const row of rows) {
      const existing = strongest.get(row.brawlhallaId)
      if (!existing || compareGlobalRows(row, existing) < 0) strongest.set(row.brawlhallaId, row)
    }
  }
  return [...strongest.values()].sort(compareGlobalRows).map((row, index) => ({ ...row, standing: index + 1 }))
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'leaderboard_collection_failed'
    const message =
      'message' in error && typeof error.message === 'string' ? error.message : 'Unknown collection failure'
    return { code, message }
  }
  return { code: 'leaderboard_collection_failed', message: 'Unknown collection failure' }
}

export async function collectAndPublish1v1Generation(input: {
  authorization: RankingPublicationAuthorization
  source: LeaderboardPageSource
  publication: RankingPublicationStore
  pageDepth?: number
  intervalMs?: number
  clock?: () => Date
}): Promise<PublicationResult> {
  const depth = input.pageDepth ?? defaultLeaderboardPageDepth
  validateDepth(depth)
  const intervalMs = input.intervalMs ?? defaultLeaderboardIntervalMs
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new LeaderboardCandidateError('publication interval must be a positive safe integer')
  }
  const clock = input.clock ?? (() => new Date())
  const observedAt = clock()
  let snapshots: ReadonlyMap<LeaderboardScope, readonly PublishedLeaderboardRow[]>
  try {
    const regional = new Map<RegionalLeaderboardScope, readonly PublishedLeaderboardRow[]>()
    for (const region of regionalLeaderboardScopes) {
      const pages: SourceLeaderboardPage[] = []
      for (let page = 1; page <= depth; page += 1) pages.push(await input.source.fetchPage({ region, page }))
      regional.set(region, validateRegionRows(region, pages, depth))
    }
    const complete = new Map<LeaderboardScope, readonly PublishedLeaderboardRow[]>(regional)
    complete.set('all', buildGlobal(regional))
    snapshots = complete
  } catch (error) {
    const details = errorDetails(error)
    const recorded = await input.publication.record1v1CollectionFailure(input.authorization, {
      checkedAt: clock(),
      ...details,
    })
    if (recorded === 'lease-lost') throw new LeaderboardLeaseLostError()
    throw error
  }

  const scheduleWindowAt = input.authorization.scheduleWindowAt
    ? new Date(input.authorization.scheduleWindowAt)
    : observedAt
  const result = await input.publication.publish1v1Generation(input.authorization, {
    operationKey: input.authorization.operationKey,
    observedAt,
    scheduleWindowAt,
    expectedNextPublicationAt: new Date(scheduleWindowAt.getTime() + intervalMs),
    pageDepth: depth,
    snapshots,
  })
  if (result === 'lease-lost') throw new LeaderboardLeaseLostError()
  if (result === 'effect-conflict') throw new LeaderboardEffectConflictError()
  return result
}

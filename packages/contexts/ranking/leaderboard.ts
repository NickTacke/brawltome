import {
  type LeaderboardMode,
  type RegionalLeaderboardScope,
  type SourceLeaderboardIdentity,
  type SourceLeaderboardPage,
  regionalLeaderboardScopes,
} from './v1-leaderboard-source'

export const defaultLeaderboardPageDepth = 1
export const maxLeaderboardPageDepth = 20
export const defaultLeaderboardIntervalMs = 15 * 60 * 1000

export type LeaderboardScope = 'all' | RegionalLeaderboardScope
export type LeaderboardOperationKind =
  | 'leaderboard-1v1'
  | 'leaderboard-2v2'
  | 'leaderboard-solo-2v2'
  | 'leaderboard-3v3'

export type PublishedLeaderboardContestant = { brawlhallaId: number; name: string }
export type PublishedLeaderboardIdentity =
  | { type: 'one-vs-one-player'; player: PublishedLeaderboardContestant }
  | {
      type: 'fixed-two-vs-two-team'
      players: readonly [PublishedLeaderboardContestant, PublishedLeaderboardContestant]
    }
  | { type: 'solo-two-vs-two-player'; player: PublishedLeaderboardContestant }
  | { type: 'three-vs-three-player'; player: PublishedLeaderboardContestant }

export type PublishedLeaderboardRow = {
  standing: number
  sourceRank: number
  identity: PublishedLeaderboardIdentity
  region: RegionalLeaderboardScope
  rating: number
  peakRating: number
  wins: number
  losses: number
  tier: string | null
}

export type LeaderboardGenerationCandidate = {
  mode: LeaderboardMode
  operationKey: string
  observedAt: Date
  scheduleWindowAt: Date
  expectedNextPublicationAt: Date
  pageDepth: number
  snapshots: ReadonlyMap<LeaderboardScope, readonly PublishedLeaderboardRow[]>
}

export type RankingPublicationAuthorization = {
  operationId: string
  effectOperationId?: string
  operationKey: string
  operationKind: LeaderboardOperationKind
  leaseOwner: string
  leaseToken: number
  scheduleWindowAt: string | null
}

export type PublicationResult = 'published' | 'already-published' | 'effect-conflict' | 'lease-lost'

export type LeaderboardView =
  | {
      status: 'fresh' | 'stale'
      snapshotId: string
      generationId: string
      mode: LeaderboardMode
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
      mode: LeaderboardMode
      page: number
      pageSize: number
    }

export type RankingQueries = {
  getLeaderboard(input: {
    mode: LeaderboardMode
    region: LeaderboardScope
    page: number
    pageSize?: number
    snapshotId?: string
    now?: Date
  }): Promise<LeaderboardView>
}

export type RankingPublicationStore = {
  publishGeneration(
    authorization: RankingPublicationAuthorization,
    candidate: LeaderboardGenerationCandidate,
  ): Promise<PublicationResult>
  recordCollectionFailure(
    authorization: RankingPublicationAuthorization,
    failure: { mode: LeaderboardMode; scope: LeaderboardScope; checkedAt: Date; code: string; message: string },
  ): Promise<'recorded' | 'lease-lost'>
}

export type LeaderboardPageSource = {
  fetchPage(input: {
    mode: LeaderboardMode
    region: RegionalLeaderboardScope
    page: number
  }): Promise<SourceLeaderboardPage>
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

export function leaderboardModeFromOperationKind(kind: LeaderboardOperationKind): LeaderboardMode {
  if (kind === 'leaderboard-solo-2v2') return 'solo2v2'
  return kind.slice('leaderboard-'.length) as LeaderboardMode
}

function validateDepth(depth: number): void {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > maxLeaderboardPageDepth) {
    throw new LeaderboardCandidateError(`page depth must be between 1 and ${maxLeaderboardPageDepth}`)
  }
}

function publishedIdentity(identity: SourceLeaderboardIdentity): PublishedLeaderboardIdentity {
  if (identity.type === 'fixed-two-vs-two-team') {
    return {
      type: identity.type,
      players: identity.players.map(({ id, username }) => ({ brawlhallaId: id, name: username })) as [
        PublishedLeaderboardContestant,
        PublishedLeaderboardContestant,
      ],
    }
  }
  return {
    type: identity.type,
    player: { brawlhallaId: identity.player.id, name: identity.player.username },
  }
}

function identityKey(mode: LeaderboardMode, identity: PublishedLeaderboardIdentity): string {
  if (mode === '1v1' && identity.type === 'one-vs-one-player') return String(identity.player.brawlhallaId)
  if (mode === 'solo2v2' && identity.type === 'solo-two-vs-two-player') return String(identity.player.brawlhallaId)
  if (mode === '3v3' && identity.type === 'three-vs-three-player') return String(identity.player.brawlhallaId)
  if (mode === '2v2' && identity.type === 'fixed-two-vs-two-team') {
    const [first, second] = identity.players
    if (first.brawlhallaId >= second.brawlhallaId) {
      throw new LeaderboardCandidateError('fixed 2v2 identity must use ascending distinct IDs')
    }
    return `${first.brawlhallaId}:${second.brawlhallaId}`
  }
  throw new LeaderboardCandidateError(`${mode} candidate contains a mismatched identity discriminator`)
}

function validateRegionRows(
  mode: LeaderboardMode,
  region: RegionalLeaderboardScope,
  pages: readonly SourceLeaderboardPage[],
  depth: number,
) {
  if (pages.length !== depth) throw new LeaderboardCandidateError(`${mode}/${region} candidate is incomplete`)
  const totalPages = pages[0]?.totalPages
  if (!totalPages || totalPages < depth) {
    throw new LeaderboardCandidateError(`${mode}/${region} does not contain configured page depth ${depth}`)
  }
  const identities = new Set<string>()
  const ranks = new Set<number>()
  const rows: PublishedLeaderboardRow[] = []
  let priorRank = 0
  for (const [pageIndex, page] of pages.entries()) {
    if (page.totalPages !== totalPages) {
      throw new LeaderboardCandidateError(`${mode}/${region} total_pages changed during collection`)
    }
    const isSourceTerminal = pageIndex + 1 === totalPages
    if (!isSourceTerminal && page.rankings.length !== 50) {
      throw new LeaderboardCandidateError(`${mode}/${region} page ${pageIndex + 1} is incomplete`)
    }
    if (page.rankings.length === 0) {
      throw new LeaderboardCandidateError(`${mode}/${region} page ${pageIndex + 1} is empty`)
    }
    for (const row of page.rankings) {
      const identity = publishedIdentity(row.identity)
      const key = identityKey(mode, identity)
      if (identities.has(key))
        throw new LeaderboardCandidateError(`${mode}/${region} contains duplicate identity ${key}`)
      if (ranks.has(row.rank))
        throw new LeaderboardCandidateError(`${mode}/${region} contains duplicate source rank ${row.rank}`)
      if (row.rank <= priorRank) {
        throw new LeaderboardCandidateError(`${mode}/${region} source ranks are not strictly increasing`)
      }
      identities.add(key)
      ranks.add(row.rank)
      priorRank = row.rank
      rows.push({
        standing: row.rank,
        sourceRank: row.rank,
        identity,
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

function firstIdentityId(identity: PublishedLeaderboardIdentity): number {
  return identity.type === 'fixed-two-vs-two-team' ? identity.players[0].brawlhallaId : identity.player.brawlhallaId
}

function compareGlobalRows(left: PublishedLeaderboardRow, right: PublishedLeaderboardRow): number {
  return (
    right.rating - left.rating ||
    right.peakRating - left.peakRating ||
    right.wins - left.wins ||
    left.losses - right.losses ||
    left.sourceRank - right.sourceRank ||
    (regionOrder.get(left.region) ?? 0) - (regionOrder.get(right.region) ?? 0) ||
    firstIdentityId(left.identity) - firstIdentityId(right.identity) ||
    identityKeyForSort(left.identity).localeCompare(identityKeyForSort(right.identity))
  )
}

function identityKeyForSort(identity: PublishedLeaderboardIdentity): string {
  return identity.type === 'fixed-two-vs-two-team'
    ? `${identity.players[0].brawlhallaId}:${identity.players[1].brawlhallaId}`
    : String(identity.player.brawlhallaId)
}

function buildGlobal(
  mode: LeaderboardMode,
  regional: ReadonlyMap<RegionalLeaderboardScope, readonly PublishedLeaderboardRow[]>,
) {
  const strongest = new Map<string, PublishedLeaderboardRow>()
  for (const region of regionalLeaderboardScopes) {
    const rows = regional.get(region)
    if (!rows) throw new LeaderboardCandidateError(`missing ${mode} regional candidate ${region}`)
    for (const row of rows) {
      const key = identityKey(mode, row.identity)
      const existing = strongest.get(key)
      if (!existing || compareGlobalRows(row, existing) < 0) strongest.set(key, row)
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

export async function collectAndPublishLeaderboardGeneration(input: {
  mode: LeaderboardMode
  authorization: RankingPublicationAuthorization
  source: LeaderboardPageSource
  publication: RankingPublicationStore
  pageDepth?: number
  intervalMs?: number
  clock?: () => Date
}): Promise<PublicationResult> {
  if (leaderboardModeFromOperationKind(input.authorization.operationKind) !== input.mode) {
    throw new LeaderboardCandidateError('leaderboard operation kind does not match collection mode')
  }
  const depth = input.pageDepth ?? defaultLeaderboardPageDepth
  validateDepth(depth)
  const intervalMs = input.intervalMs ?? defaultLeaderboardIntervalMs
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new LeaderboardCandidateError('publication interval must be a positive safe integer')
  }
  const clock = input.clock ?? (() => new Date())
  const observedAt = clock()
  let snapshots: ReadonlyMap<LeaderboardScope, readonly PublishedLeaderboardRow[]>
  let failureScope: LeaderboardScope = 'all'
  try {
    const regional = new Map<RegionalLeaderboardScope, readonly PublishedLeaderboardRow[]>()
    for (const region of regionalLeaderboardScopes) {
      failureScope = region
      const pages: SourceLeaderboardPage[] = []
      for (let page = 1; page <= depth; page += 1) {
        pages.push(await input.source.fetchPage({ mode: input.mode, region, page }))
      }
      regional.set(region, validateRegionRows(input.mode, region, pages, depth))
    }
    failureScope = 'all'
    const complete = new Map<LeaderboardScope, readonly PublishedLeaderboardRow[]>(regional)
    complete.set('all', buildGlobal(input.mode, regional))
    snapshots = complete
  } catch (error) {
    if (error instanceof LeaderboardLeaseLostError) throw error
    const details = errorDetails(error)
    const recorded = await input.publication.recordCollectionFailure(input.authorization, {
      mode: input.mode,
      scope: failureScope,
      checkedAt: clock(),
      ...details,
    })
    if (recorded === 'lease-lost') throw new LeaderboardLeaseLostError()
    throw error
  }

  const scheduleWindowAt = input.authorization.scheduleWindowAt
    ? new Date(input.authorization.scheduleWindowAt)
    : observedAt
  const result = await input.publication.publishGeneration(input.authorization, {
    mode: input.mode,
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

export type ProjectionOwner = 'player' | 'clan'

export type ProjectionSnapshot<T> = {
  sourceVersion: number
  facts: T[]
  pendingEventCount?: number
  oldestPendingAt?: Date | null
}

export type PlayerDiscoveryFact = {
  brawlhallaId: number
  name: string
  region: string | null
  rating: number | null
  viewCount: number
  bestLegendNameKey: string | null
  aliases: string[]
}

export type ClanDiscoveryFact = {
  clanId: number
  clanName: string
  clanXp: string
  memberCount: number
}

export type PlayerProjectionEvent = {
  eventId: string
  brawlhallaId: number
  sourceVersion: number
  fact: PlayerDiscoveryFact | null
}

export type ClanProjectionEvent = {
  eventId: string
  clanId: number
  sourceVersion: number
  fact: ClanDiscoveryFact | null
}

export type PlayerProjectionSnapshot = ProjectionSnapshot<PlayerDiscoveryFact>
export type ClanProjectionSnapshot = ProjectionSnapshot<ClanDiscoveryFact>

export interface PlayerProjectionSource {
  pendingEvents(limit: number): Promise<PlayerProjectionEvent[]>
  acknowledgeEvents(eventIds: string[]): Promise<void>
  snapshot(): Promise<PlayerProjectionSnapshot>
  lag(): Promise<number>
}

export interface ClanProjectionSource {
  pendingEvents(limit: number): Promise<ClanProjectionEvent[]>
  acknowledgeEvents(eventIds: string[]): Promise<void>
  snapshot(): Promise<ClanProjectionSnapshot>
  lag(): Promise<number>
}

export type PlayerSearchHit = {
  brawlhallaId: number
  name: string
  region: string | null
  rating: number | null
  viewCount: number
  bestLegendNameKey: string | null
  matchedAlias: string | null
}

export type ClanSearchHit = {
  clanId: number
  clanName: string
  clanXp: string
  memberCount: number
}

export type DiscoverySearchResult = {
  players: PlayerSearchHit[]
  clans: ClanSearchHit[]
}

export type ReconciliationDifference = {
  entityId: number
  kind: 'missing' | 'unexpected' | 'mismatched'
}

export type ReconciliationResult = {
  runId: string
  owner: ProjectionOwner
  observedSourceVersion: number
  pendingEventCount: number
  oldestPendingAt: Date | null
  expectedHash: string
  projectedHashBefore: string
  projectedHashAfter: string
  exactBefore: boolean
  exactAfter: boolean
  repaired: boolean
  differenceCount: number
  differenceDetailsTruncated: boolean
  differences: ReconciliationDifference[]
}

export interface DiscoveryQueries {
  search(rawQuery: string): Promise<DiscoverySearchResult>
}

export type SemanticMigrationFixtureKind =
  | 'canonical-identity'
  | 'exact-prefix'
  | 'normalized-exact-name'
  | 'local-name'
  | 'negative-legacy-only'
  | 'preserved-route'
  | 'ranking-accepted'
  | 'ranking-rejected'

export type SemanticMigrationExplanationCode =
  | 'exact-first-ranking'
  | 'legacy-only-not-owner-fact'
  | 'ranking-set-rejected'

export type SemanticMigrationFixture = {
  key: string
  kind: SemanticMigrationFixtureKind
  expected: unknown
  legacy: unknown
  actual: unknown
  explanationCode: SemanticMigrationExplanationCode | null
}

export type MigrationEvidenceInput = {
  operationKey: string
  sourceEvidenceHash: string
  playerReconciliation: ReconciliationResult
  clanReconciliation: ReconciliationResult
  pendingPlayerEvents: number
  pendingClanEvents: number
  fixtures: SemanticMigrationFixture[]
}

export type SemanticMigrationMismatch = {
  fixtureKey: string
  fixtureKind: SemanticMigrationFixtureKind
  explanationCode: SemanticMigrationExplanationCode | null
  expected: unknown
  legacy: unknown
  actual: unknown
  reason: string
}

export type MigrationEvidenceResult = {
  runId: string
  operationKey: string
  inputHash: string
  sourceEvidenceHash: string
  status: 'passed' | 'blocked'
  playerProjectionHash: string
  clanProjectionHash: string
  fixtureHash: string
  fixtureCount: number
  intentionalDifferenceCount: number
  unexplainedMismatchCount: number
  mismatchDetailCount: number
  mismatchDetailsTruncated: boolean
  mismatches: SemanticMigrationMismatch[]
}

export function normalizeDiscoveryTerm(value: string): string {
  return value
    .replace(/[%\\_]/g, '')
    .trim()
    .replace(/\s*\|\s*/g, ' | ')
    .toLowerCase()
}

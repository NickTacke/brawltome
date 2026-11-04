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
export type ProjectionSnapshotStream<T> = {
  sourceVersion: number
  pendingEventCount: number
  oldestPendingAt: Date | null
  facts(): AsyncIterable<T>
}

export interface PlayerProjectionSource {
  pendingEvents(limit: number): Promise<PlayerProjectionEvent[]>
  acknowledgeEvents(eventIds: string[]): Promise<void>
  snapshot(): Promise<PlayerProjectionSnapshot>
  withSnapshot?<T>(consume: (snapshot: ProjectionSnapshotStream<PlayerDiscoveryFact>) => Promise<T>): Promise<T>
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

// Folds what people don't type when searching: accents ("La Fée" -> "la fee") and styled letters like full-width or
// mathematical alphabets ("𝓐𝓵𝓹𝓱𝓪" -> "alpha"). Only marks on Latin letters go, so Japanese voicing marks stay.
export function normalizeDiscoveryTerm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[%\\_]/g, '')
    .trim()
    .replace(/\s*\|\s*/g, ' | ')
    .toLowerCase()
}

/** One way a player can be found: their name, a `|` segment of it, an earlier name, or the name from a word on. */
export type PlayerSearchTerm = {
  kind: 'canonical' | 'segment' | 'alias' | 'word'
  display: string
  normalized: string
}

// Every term a player is indexed under. Search and reconciliation both use this one list.
export function playerSearchTerms(fact: PlayerDiscoveryFact): PlayerSearchTerm[] {
  const terms: PlayerSearchTerm[] = []
  const seen = new Set<string>()
  const add = (kind: PlayerSearchTerm['kind'], display: string) => {
    const normalized = normalizeDiscoveryTerm(display)
    const identity = `${kind}:${normalized}`
    if (!normalized || seen.has(identity)) return
    seen.add(identity)
    terms.push({ kind, display, normalized })
  }

  add('canonical', fact.name)
  for (const segment of fact.name.split('|')) {
    if (normalizeDiscoveryTerm(segment) !== normalizeDiscoveryTerm(fact.name)) add('segment', segment.trim())
  }
  for (const alias of fact.aliases) add('alias', alias)

  // A word start only needs its own term when no name term starts with it; "Ahmed PickleBall" already matches "ahmed".
  const nameTerms = terms.filter((term) => term.kind !== 'alias').map((term) => term.normalized)
  for (const wordStart of nameFromEachWord(fact.name)) {
    const normalized = normalizeDiscoveryTerm(wordStart)
    if (!nameTerms.some((nameTerm) => nameTerm.startsWith(normalized))) add('word', wordStart)
  }

  return terms
}

// The rest of each name segment from every word on, without the decoration in front: "THE BEST UNARMED" gives
// "BEST UNARMED" and "UNARMED", and "ó ¡pefura" gives "pefura". Keeping the rest of the name lets a search span words.
// Starts under two characters are skipped, since a search needs at least two.
function nameFromEachWord(name: string): string[] {
  const wordStarts: string[] = []
  for (const segment of name.split('|')) {
    const words = segment.trim().split(/\s+/)
    for (let index = 0; index < words.length; index++) {
      const wordStart = words
        .slice(index)
        .join(' ')
        .replace(/^[^\p{L}\p{N}]+/u, '')
      if ([...normalizeDiscoveryTerm(wordStart)].length >= 2) wordStarts.push(wordStart)
    }
  }

  return wordStarts
}

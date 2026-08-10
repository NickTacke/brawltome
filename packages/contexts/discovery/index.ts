export type PlayerDiscoveryFact = {
  brawlhallaId: number
  name: string
  region: string | null
  rating: number | null
  viewCount: number
  bestLegendNameKey: string | null
  aliases: string[]
}

export type PlayerProjectionEvent = {
  eventId: string
  brawlhallaId: number
  sourceVersion: number
  fact: PlayerDiscoveryFact | null
}

export type PlayerProjectionSnapshot = {
  sourceVersion: number
  facts: PlayerDiscoveryFact[]
}

export interface PlayerProjectionSource {
  pendingEvents(limit: number): Promise<PlayerProjectionEvent[]>
  acknowledgeEvents(eventIds: string[]): Promise<void>
  snapshot(): Promise<PlayerProjectionSnapshot>
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

export interface DiscoveryQueries {
  searchPlayers(rawQuery: string): Promise<PlayerSearchHit[]>
}

export function normalizeDiscoveryTerm(value: string): string {
  return value
    .replace(/[%\\_]/g, '')
    .trim()
    .replace(/\s*\|\s*/g, ' | ')
    .toLowerCase()
}

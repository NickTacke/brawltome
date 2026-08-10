export type PlayerDiscoveryFact = {
  brawlhallaId: number
  name: string
  region: string | null
  rating: number | null
  viewCount: number
  bestLegendNameKey: string | null
  aliases: string[]
}

export type PlayerDiscoveryEvent = {
  eventId: string
  brawlhallaId: number
  sourceVersion: number
  fact: PlayerDiscoveryFact | null
}

export type PlayerDiscoverySnapshot = {
  sourceVersion: number
  facts: PlayerDiscoveryFact[]
  pendingEventCount: number
  oldestPendingAt: Date | null
}

export interface PlayerDiscoverySource {
  pendingEvents(limit: number): Promise<PlayerDiscoveryEvent[]>
  acknowledgeEvents(eventIds: string[]): Promise<void>
  replayDeliveredEvents(eventIds: string[]): Promise<void>
  snapshot(): Promise<PlayerDiscoverySnapshot>
  lag(): Promise<number>
}

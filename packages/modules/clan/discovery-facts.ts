export type ClanDiscoveryFact = {
  clanId: number
  clanName: string
  clanXp: string
  memberCount: number
}

export type ClanDiscoveryEvent = {
  eventId: string
  clanId: number
  sourceVersion: number
  fact: ClanDiscoveryFact | null
}

export type ClanDiscoverySnapshot = {
  sourceVersion: number
  facts: ClanDiscoveryFact[]
  pendingEventCount: number
  oldestPendingAt: Date | null
}

export interface ClanDiscoverySource {
  pendingEvents(limit: number): Promise<ClanDiscoveryEvent[]>
  acknowledgeEvents(eventIds: string[]): Promise<void>
  replayDeliveredEvents(eventIds: string[]): Promise<void>
  snapshot(): Promise<ClanDiscoverySnapshot>
  lag(): Promise<number>
}

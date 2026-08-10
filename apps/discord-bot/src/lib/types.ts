import type { api } from './trpc'

// Infer canonical wire models from the tRPC client.
export type PlayerReferenceResponse = NonNullable<Awaited<ReturnType<typeof api.player.referenceById.query>>>
export type PlayerRankedResponse = Awaited<ReturnType<typeof api.player.rankedById.query>>
export type PlayerCareerResponse = Awaited<ReturnType<typeof api.player.careerById.query>>
export type PlayerRefreshResponse = Awaited<ReturnType<typeof api.player.refreshDiscord.mutate>>
export type CanonicalPlayerResponse = {
  reference: PlayerReferenceResponse
  currentSeason: PlayerRankedResponse
  career: PlayerCareerResponse
}
export type ClanResponse = NonNullable<Awaited<ReturnType<typeof api.clan.byId.query>>>
export type ClanRefreshResponse = Awaited<ReturnType<typeof api.clan.refreshDiscord.mutate>>
export type SearchResponse = Awaited<ReturnType<typeof api.search.local.query>>

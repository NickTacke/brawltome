import type { api } from './trpc'

// Infer types from tRPC client
export type PlayerResponse = NonNullable<Awaited<ReturnType<typeof api.player.byId.query>>>
export type ClanResponse = NonNullable<Awaited<ReturnType<typeof api.clan.byId.query>>>
export type SearchResponse = Awaited<ReturnType<typeof api.search.local.query>>
export type StatusResponse = Awaited<ReturnType<typeof api.status.health.query>>

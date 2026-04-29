export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100
export const STALE_RANK_MS = 30 * 60 * 1000

export interface LeaderboardInput {
  bracket: '1v1' | '2v2' | 'solo2v2' | '3v3'
  region: string
  page: number
  pageSize?: number
}

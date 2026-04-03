export const JANITOR_MIN_TOKENS = 100
export const MAX_PAGES = 200
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

export type SortField = 'rating' | 'peakRating' | 'wins' | 'games'
export type SortOrder = 'asc' | 'desc'

export interface LeaderboardInput {
  bracket: '1v1' | '2v2'
  region: string
  page: number
  pageSize?: number
  sort?: SortField
  order?: SortOrder
}

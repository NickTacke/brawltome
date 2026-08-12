export type PlayerReference = {
  brawlhallaId: number
  name: string
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

export interface PlayerReferenceQueries {
  byId(brawlhallaId: number): Promise<PlayerReference | null>
}

export type PlayerReference = {
  brawlhallaId: number
  name: string
  bestLegendNameKey?: string | null
}

export interface PlayerReferenceQueries {
  byId(brawlhallaId: number): Promise<PlayerReference | null>
}

export type PlayerReference = {
  brawlhallaId: number
  name: string
}

export interface PlayerReferenceQueries {
  byId(brawlhallaId: number): Promise<PlayerReference | null>
}

export type PlayerReference = {
  brawlhallaId: number
  name: string
  aliases: string[]
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

export interface PlayerReferenceQueries {
  byId(brawlhallaId: number): Promise<PlayerReference | null>
}

export type CanonicalPlayerNameEvidence = { name: string }

export function isUsablePlayerName(name: string, brawlhallaId: number): boolean {
  return name !== `Player ${brawlhallaId}` && [...name].length <= 256 && /[^\p{Separator}\p{Format}]/u.test(name)
}

export function selectCanonicalPlayerName<T extends CanonicalPlayerNameEvidence>(input: {
  brawlhallaId: number
  ranked: T | null
  career: T | null
}): T | null {
  const career = input.career && isUsablePlayerName(input.career.name, input.brawlhallaId) ? input.career : null
  if (career) return career
  return input.ranked && isUsablePlayerName(input.ranked.name, input.brawlhallaId) ? input.ranked : null
}

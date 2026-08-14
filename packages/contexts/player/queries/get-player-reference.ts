import type { PlayerReference } from '../reference'

type StoredPlayerReference = PlayerReference & Record<string, unknown>
type FindStoredPlayerReference = (brawlhallaId: number) => Promise<StoredPlayerReference | null>

export function isUsablePlayerName(name: string, brawlhallaId: number): boolean {
  return name !== `Player ${brawlhallaId}` && [...name].length <= 256 && /[^\p{Separator}\p{Format}]/u.test(name)
}

export async function getPlayerReference(
  findStoredReference: FindStoredPlayerReference,
  brawlhallaId: number,
): Promise<PlayerReference | null> {
  const stored = await findStoredReference(brawlhallaId)
  if (!stored || !isUsablePlayerName(stored.name, brawlhallaId)) return null
  return {
    brawlhallaId: stored.brawlhallaId,
    name: stored.name,
    ...(stored.bestLegendNameKey !== undefined ? { bestLegendNameKey: stored.bestLegendNameKey } : {}),
    ...(stored.legacyRating !== undefined ? { legacyRating: stored.legacyRating } : {}),
  }
}

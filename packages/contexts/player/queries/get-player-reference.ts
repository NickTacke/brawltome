import { type PlayerReference, isUsablePlayerName } from '../reference'

type StoredPlayerReference = PlayerReference & Record<string, unknown>
type FindStoredPlayerReference = (brawlhallaId: number) => Promise<StoredPlayerReference | null>

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

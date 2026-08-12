import type { PlayerReference } from '../reference'

type StoredPlayerReference = PlayerReference & Record<string, unknown>
type FindStoredPlayerReference = (brawlhallaId: number) => Promise<StoredPlayerReference | null>

export async function getPlayerReference(
  findStoredReference: FindStoredPlayerReference,
  brawlhallaId: number,
): Promise<PlayerReference | null> {
  const stored = await findStoredReference(brawlhallaId)
  if (!stored || stored.name === `Player ${brawlhallaId}`) return null
  return {
    brawlhallaId: stored.brawlhallaId,
    name: stored.name,
    ...(stored.bestLegendNameKey !== undefined ? { bestLegendNameKey: stored.bestLegendNameKey } : {}),
  }
}

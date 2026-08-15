import { decodeV0CareerNameCandidate } from '../career/source'
import { type PlayerReference, isUsablePlayerName } from '../reference'

type StoredPlayerReference = Omit<PlayerReference, 'aliases'> & { aliases?: unknown } & Record<string, unknown>
type FindStoredPlayerReference = (brawlhallaId: number) => Promise<StoredPlayerReference | null>

export async function getPlayerReference(
  findStoredReference: FindStoredPlayerReference,
  brawlhallaId: number,
): Promise<PlayerReference | null> {
  const stored = await findStoredReference(brawlhallaId)
  if (!stored || !isUsablePlayerName(stored.name, brawlhallaId)) return null
  const aliases = Array.isArray(stored.aliases)
    ? stored.aliases.filter(
        (alias): alias is string =>
          typeof alias === 'string' &&
          alias.toLowerCase() !== stored.name.toLowerCase() &&
          decodeV0CareerNameCandidate(alias) !== stored.name &&
          isUsablePlayerName(alias, brawlhallaId),
      )
    : []
  return {
    brawlhallaId: stored.brawlhallaId,
    name: stored.name,
    aliases: [...new Set(aliases)],
    ...(stored.bestLegendNameKey !== undefined ? { bestLegendNameKey: stored.bestLegendNameKey } : {}),
    ...(stored.legacyRating !== undefined ? { legacyRating: stored.legacyRating } : {}),
  }
}

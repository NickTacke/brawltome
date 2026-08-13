import { type PlayerReferenceContract, parsePlayerReferenceOutput } from '@brawltome/contracts'
import type { PlayerReference } from '@brawltome/player'

export function mapPlayerReference(reference: PlayerReference | null): PlayerReferenceContract | null {
  if (!reference) return null
  return parsePlayerReferenceOutput({
    brawlhallaId: reference.brawlhallaId,
    name: reference.name,
    ...(reference.bestLegendNameKey !== undefined ? { bestLegendNameKey: reference.bestLegendNameKey } : {}),
    ...(reference.legacyRating !== undefined ? { legacyRating: reference.legacyRating } : {}),
  })
}

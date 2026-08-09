import { getPlayerReference } from './queries/get-player-reference'
import type { PlayerReference, PlayerReferenceQueries } from './reference'

export type FindStoredPlayerReference = (
  brawlhallaId: number,
) => Promise<(PlayerReference & Record<string, unknown>) | null>

export function createPlayerReferenceQueries(findStoredReference: FindStoredPlayerReference): PlayerReferenceQueries {
  return {
    byId: (brawlhallaId) => getPlayerReference(findStoredReference, brawlhallaId),
  }
}

import { initializePlayersSchema } from './migrations/0001-initialize-schema'
import { addInteractiveRefreshEffects } from './migrations/0002-add-interactive-refresh-effects'
import { addCanonicalRankedState } from './migrations/0003-add-canonical-ranked-state'

export { discoverPlayer } from './commands/discover-player'
export { processRefreshRanked, processRefreshStats, type PlayerRefreshEffect } from './commands/refresh-player'
export {
  createPostgresRankedPlayers,
  type CanonicalRankedEffect,
  type PostgresRankedPlayers,
} from './ranked/postgres'
export { refreshCanonicalRankedPlayer, type V0RankedSource } from './ranked/refresh'
export { createPlayerReferenceQueries, type FindStoredPlayerReference } from './player-reference.queries'
export { createPlayerRepo } from './player.repo'

export const playerMigrationInventory = [
  initializePlayersSchema,
  addInteractiveRefreshEffects,
  addCanonicalRankedState,
] as const

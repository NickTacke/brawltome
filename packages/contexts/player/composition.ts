import { initializePlayersSchema } from './migrations/0001-initialize-schema'
import { addInteractiveRefreshEffects } from './migrations/0002-add-interactive-refresh-effects'

export { discoverPlayer } from './commands/discover-player'
export { processRefreshRanked, processRefreshStats, type PlayerRefreshEffect } from './commands/refresh-player'
export { createPlayerReferenceQueries, type FindStoredPlayerReference } from './player-reference.queries'
export { createPlayerRepo } from './player.repo'

export const playerMigrationInventory = [initializePlayersSchema, addInteractiveRefreshEffects] as const

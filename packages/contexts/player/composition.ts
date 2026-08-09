import { initializePlayersSchema } from './migrations/0001-initialize-schema'

export { discoverPlayer } from './commands/discover-player'
export { processRefreshRanked, processRefreshStats } from './commands/refresh-player'
export { createPlayerReferenceQueries, type FindStoredPlayerReference } from './player-reference.queries'
export { createPlayerRepo } from './player.repo'

export const playerMigrationInventory = [initializePlayersSchema] as const

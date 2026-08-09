import { initializePlayersSchema } from './migrations/0001-initialize-schema'

export const playerMigrationInventory = [initializePlayersSchema] as const

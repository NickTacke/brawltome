import { initializeClans } from './migrations/0001-initialize-clans'

export { createPostgresClans, type PostgresClans } from './postgres'
export { importLegacyClans } from './legacy-import'

export const clanMigrationInventory = [initializeClans] as const

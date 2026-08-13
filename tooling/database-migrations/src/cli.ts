import { globalMigrationInventory } from './inventories'
import { migratePostgres } from './postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const applied = await migratePostgres(connectionString, globalMigrationInventory)
console.log(applied === 0 ? 'V3 migrations are up to date.' : `Applied ${applied} V3 migration(s).`)

import { globalMigrationInventory } from './inventories'
import { checkDeployedMigrationsPresent } from './order'
import { migratePostgres } from './postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

checkDeployedMigrationsPresent(globalMigrationInventory)
const applied = await migratePostgres(connectionString, globalMigrationInventory)
console.log(applied === 0 ? 'Migrations are up to date.' : `Applied ${applied} migration(s).`)

import { checkModuleList } from '@brawltome/foundation'
import { orderedMigrations } from './inventories'
import { migrationModules } from './modules'
import { checkDeployedMigrationsPresent } from './order'
import { migratePostgres } from './postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

checkModuleList(migrationModules)
checkDeployedMigrationsPresent(orderedMigrations)
const applied = await migratePostgres(connectionString, orderedMigrations)
console.log(applied === 0 ? 'Migrations are up to date.' : `Applied ${applied} migration(s).`)

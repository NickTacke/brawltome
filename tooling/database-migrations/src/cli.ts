import { checkDeployedMigrationsPresent, checkModuleList, migratePostgres } from '@brawltome/foundation'
import { orderedMigrations } from './inventories'
import { migrationModules } from './modules'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

checkModuleList(migrationModules)
checkDeployedMigrationsPresent(orderedMigrations)
const applied = await migratePostgres(connectionString, orderedMigrations)

console.log(applied === 0 ? 'Migrations are up to date.' : `Applied ${applied} migration(s).`)

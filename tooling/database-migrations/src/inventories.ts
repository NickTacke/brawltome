import { type Migration, orderMigrations } from '@brawltome/foundation'
import { migrationModules } from './modules'

// every module's migrations in the order a fresh database applies them
export const orderedMigrations: readonly Migration[] = orderMigrations(
  migrationModules.flatMap((module) => module.migrations),
)

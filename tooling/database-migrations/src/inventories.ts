import { playerMigrationInventory } from '@brawltome/player/composition'
import { refreshOperationsMigrationInventory } from '@brawltome/refresh-operations/composition'
import type { Migration } from './plan'

export const globalMigrationInventory: readonly Migration[] = [
  ...playerMigrationInventory,
  ...refreshOperationsMigrationInventory,
]

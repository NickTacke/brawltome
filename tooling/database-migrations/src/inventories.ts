import { playerMigrationInventory } from '@brawltome/player/composition'
import type { Migration } from './plan'

export const globalMigrationInventory: readonly Migration[] = [...playerMigrationInventory]

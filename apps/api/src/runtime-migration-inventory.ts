import { accountsMigrationInventory } from '@brawltome/accounts/composition'
import { clanMigrationInventory } from '@brawltome/clan/composition'
import { playerMigrationInventory } from '@brawltome/player/composition'
import { rankingMigrationInventory } from '@brawltome/ranking/composition'
import { refreshOperationsMigrationInventory } from '@brawltome/refresh-operations/composition'
import { requestAdmissionMigrationInventory } from '@brawltome/request-admission/composition'

export const runtimeMigrationInventory = [
  ...playerMigrationInventory,
  ...refreshOperationsMigrationInventory.slice(0, 6),
  ...requestAdmissionMigrationInventory,
  ...accountsMigrationInventory,
  ...rankingMigrationInventory,
  ...clanMigrationInventory,
  refreshOperationsMigrationInventory[6],
  refreshOperationsMigrationInventory[7],
] as const

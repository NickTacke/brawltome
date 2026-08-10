import { accountsMigrationInventory } from '@brawltome/accounts/composition'
import { clanMigrationInventory } from '@brawltome/clan/composition'
import { discoveryMigrationInventory } from '@brawltome/discovery/composition'
import { playerMigrationInventory } from '@brawltome/player/composition'
import { rankingMigrationInventory } from '@brawltome/ranking/composition'
import { refreshOperationsMigrationInventory } from '@brawltome/refresh-operations/composition'
import { requestAdmissionMigrationInventory } from '@brawltome/request-admission/composition'

export const runtimeMigrationInventory = [
  ...playerMigrationInventory.slice(0, 3),
  ...refreshOperationsMigrationInventory.slice(0, 6),
  ...requestAdmissionMigrationInventory,
  ...accountsMigrationInventory,
  rankingMigrationInventory[0],
  ...clanMigrationInventory,
  refreshOperationsMigrationInventory[6],
  refreshOperationsMigrationInventory[7],
  refreshOperationsMigrationInventory[8],
  rankingMigrationInventory[1],
  playerMigrationInventory[3],
  playerMigrationInventory[4],
  refreshOperationsMigrationInventory[9],
  ...discoveryMigrationInventory,
] as const

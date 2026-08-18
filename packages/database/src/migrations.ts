import { accountsMigrationInventory } from '@brawltome/accounts/composition'
import { clanMigrationInventory } from '@brawltome/clan/composition'
import { discoveryMigrationInventory } from '@brawltome/discovery/composition'
import { playerMigrationInventory } from '@brawltome/player/composition'
import { rankingMigrationInventory } from '@brawltome/ranking/composition'
import { refreshOperationsMigrationInventory } from '@brawltome/refresh-operations/composition'
import { replayAnalysisMigrationInventory } from '@brawltome/replay-analysis/composition'
import { requestAdmissionMigrationInventory } from '@brawltome/request-admission/composition'
import { statisticsMigrationInventory } from '@brawltome/statistics/composition'

export const globalMigrationInventory = [
  ...playerMigrationInventory.slice(0, 3),
  ...refreshOperationsMigrationInventory.slice(0, 6),
  ...requestAdmissionMigrationInventory.slice(0, 2),
  ...accountsMigrationInventory.slice(0, 2),
  rankingMigrationInventory[0],
  clanMigrationInventory[0],
  refreshOperationsMigrationInventory[6],
  refreshOperationsMigrationInventory[7],
  accountsMigrationInventory[2],
  refreshOperationsMigrationInventory[8],
  rankingMigrationInventory[1],
  playerMigrationInventory[3],
  playerMigrationInventory[4],
  refreshOperationsMigrationInventory[9],
  discoveryMigrationInventory[0],
  accountsMigrationInventory[3],
  playerMigrationInventory[5],
  refreshOperationsMigrationInventory[10],
  refreshOperationsMigrationInventory[11],
  clanMigrationInventory[1],
  discoveryMigrationInventory[1],
  refreshOperationsMigrationInventory[12],
  statisticsMigrationInventory[0],
  refreshOperationsMigrationInventory[13],
  accountsMigrationInventory[4],
  playerMigrationInventory[6],
  statisticsMigrationInventory[1],
  refreshOperationsMigrationInventory[14],
  clanMigrationInventory[2],
  rankingMigrationInventory[2],
  accountsMigrationInventory[5],
  statisticsMigrationInventory[2],
  refreshOperationsMigrationInventory[15],
  statisticsMigrationInventory[3],
  requestAdmissionMigrationInventory[2],
  discoveryMigrationInventory[2],
  accountsMigrationInventory[6],
  rankingMigrationInventory[3],
  rankingMigrationInventory[4],
  playerMigrationInventory[7],
  rankingMigrationInventory[5],
  playerMigrationInventory[8],
  playerMigrationInventory[9],
  clanMigrationInventory[3],
  playerMigrationInventory[10],
  playerMigrationInventory[11],
  playerMigrationInventory[12],
  replayAnalysisMigrationInventory[0],
  accountsMigrationInventory[7],
] as const

import { initializeRefreshOperations } from './migrations/0001-initialize-operations'
import { addSchedulingAndAdmission } from './migrations/0002-add-scheduling-and-admission'
import { addInteractiveRefreshReservations } from './migrations/0003-interactive-refresh-reservations'
import { addInteractiveRefreshCheckpoints } from './migrations/0004-add-interactive-checkpoints'
import { addLeaderboardOperationKind } from './migrations/0005-add-leaderboard-kind'
import { exposeActiveLeaseFence } from './migrations/0006-expose-active-lease-fence'
import { addClanRefresh } from './migrations/0007-add-clan-refresh'
import { addDeadLetterOperations } from './migrations/0008-add-dead-letter-operations'
import { addLeaderboardOperationModes } from './migrations/0009-add-leaderboard-modes'
import { addPlayerDiscoveryProjection } from './migrations/0010-add-player-discovery-projection'
import { addRankedPlayerPulseOperation } from './migrations/0011-add-ranked-player-pulse'

export {
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  type PostgresDeadLetterOperations,
  type PostgresRefreshOperations,
} from './postgres'

export const refreshOperationsMigrationInventory = [
  initializeRefreshOperations,
  addSchedulingAndAdmission,
  addInteractiveRefreshReservations,
  addInteractiveRefreshCheckpoints,
  addLeaderboardOperationKind,
  exposeActiveLeaseFence,
  addClanRefresh,
  addDeadLetterOperations,
  addLeaderboardOperationModes,
  addPlayerDiscoveryProjection,
  addRankedPlayerPulseOperation,
] as const

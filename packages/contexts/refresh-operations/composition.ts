import { initializeRefreshOperations } from './migrations/0001-initialize-operations'
import { addSchedulingAndAdmission } from './migrations/0002-add-scheduling-and-admission'
import { addInteractiveRefreshReservations } from './migrations/0003-interactive-refresh-reservations'
import { addInteractiveRefreshCheckpoints } from './migrations/0004-add-interactive-checkpoints'
import { addLeaderboardOperationKind } from './migrations/0005-add-leaderboard-kind'
import { exposeActiveLeaseFence } from './migrations/0006-expose-active-lease-fence'
import { addClanRefresh } from './migrations/0007-add-clan-refresh'

export { createPostgresRefreshOperations, type PostgresRefreshOperations } from './postgres'

export const refreshOperationsMigrationInventory = [
  initializeRefreshOperations,
  addSchedulingAndAdmission,
  addInteractiveRefreshReservations,
  addInteractiveRefreshCheckpoints,
  addLeaderboardOperationKind,
  exposeActiveLeaseFence,
  addClanRefresh,
] as const

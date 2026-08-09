import { initializeRefreshOperations } from './migrations/0001-initialize-operations'
import { addSchedulingAndAdmission } from './migrations/0002-add-scheduling-and-admission'
import { addInteractiveRefreshReservations } from './migrations/0003-interactive-refresh-reservations'
import { addInteractiveRefreshCheckpoints } from './migrations/0004-add-interactive-checkpoints'

export { createPostgresRefreshOperations, type PostgresRefreshOperations } from './postgres'

export const refreshOperationsMigrationInventory = [
  initializeRefreshOperations,
  addSchedulingAndAdmission,
  addInteractiveRefreshReservations,
  addInteractiveRefreshCheckpoints,
] as const

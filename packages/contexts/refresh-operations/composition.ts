import { initializeRefreshOperations } from './migrations/0001-initialize-operations'
import { addSchedulingAndAdmission } from './migrations/0002-add-scheduling-and-admission'

export { createPostgresRefreshOperations, type PostgresRefreshOperations } from './postgres'

export const refreshOperationsMigrationInventory = [initializeRefreshOperations, addSchedulingAndAdmission] as const

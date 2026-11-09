import { refreshOperationsModule } from '@brawltome/queue'
import { accountsModule } from './index'

// accounts' migrations move a table out of the queue's schema, so a test database needs both, in this order
export const accountsTestModules = [refreshOperationsModule, accountsModule] as const

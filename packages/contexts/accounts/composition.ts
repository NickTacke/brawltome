import { initializeAndImportV2Accounts } from './migrations/0001-initialize-and-import-v2'
import { createAccounts } from './src/accounts'
import { createPostgresAccountsStore } from './src/postgres-store'

export function createPostgresAccounts(connectionString: string) {
  const { store, close } = createPostgresAccountsStore(connectionString)
  return { accounts: createAccounts({ store }), close }
}

export const accountsMigrationInventory = [initializeAndImportV2Accounts] as const

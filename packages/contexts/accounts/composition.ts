import { initializeAndImportV2Accounts } from './migrations/0001-initialize-and-import-v2'
import { addV2AuthCutoverState } from './migrations/0002-add-v2-auth-cutover-state'
import { createAccounts } from './src/accounts'
import { createPostgresAccountsStore } from './src/postgres-store'

export interface V2AuthCutoverGate {
  legacyWritersQuiesced: true
}

export function createPostgresAccounts(connectionString: string) {
  const { store, finalizeV2AuthCutover, close } = createPostgresAccountsStore(connectionString)
  return {
    accounts: createAccounts({ store }),
    async finalizeV2AuthCutover(gate: V2AuthCutoverGate) {
      if (gate.legacyWritersQuiesced !== true) {
        throw new Error('Legacy auth writers must be quiescent before finalization')
      }
      return finalizeV2AuthCutover()
    },
    close,
  }
}

export const accountsMigrationInventory = [initializeAndImportV2Accounts, addV2AuthCutoverState] as const

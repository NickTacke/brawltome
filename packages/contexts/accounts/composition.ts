import { initializeAndImportV2Accounts } from './migrations/0001-initialize-and-import-v2'
import { addV2AuthCutoverState } from './migrations/0002-add-v2-auth-cutover-state'
import { addAccountPreferences } from './migrations/0003-add-preferences'
import { addPrimaryPlayerVerification } from './migrations/0004-add-primary-player-verification'
import { addSavedPlayers } from './migrations/0005-add-saved-players'
import { addPinnedPlayerShortcuts } from './migrations/0006-add-pinned-player-shortcuts'
import { createAccounts } from './src/accounts'

export { MAX_PINNED_PLAYERS, MAX_SAVED_PLAYERS } from './src/accounts'
import { createPostgresAccountsStore } from './src/postgres-store'

export interface V2AuthCutoverGate {
  legacyWritersQuiesced: true
}

export function createPostgresAccounts(connectionString: string) {
  const { store, finalizeV2AuthCutover, close } = createPostgresAccountsStore(connectionString)
  return {
    accounts: createAccounts({ store }),
    primaryMonitoring: { readSnapshot: store.readPrimaryMonitoringSnapshot },
    async finalizeV2AuthCutover(gate: V2AuthCutoverGate) {
      if (gate.legacyWritersQuiesced !== true) {
        throw new Error('Legacy auth writers must be quiescent before finalization')
      }
      return finalizeV2AuthCutover()
    },
    close,
  }
}

export const accountsMigrationInventory = [
  initializeAndImportV2Accounts,
  addV2AuthCutoverState,
  addAccountPreferences,
  addPrimaryPlayerVerification,
  addSavedPlayers,
  addPinnedPlayerShortcuts,
] as const

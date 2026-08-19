import { initializeAndImportV2Accounts } from './migrations/0001-initialize-and-import-v2'
import { addV2AuthCutoverState } from './migrations/0002-add-v2-auth-cutover-state'
import { addAccountPreferences } from './migrations/0003-add-preferences'
import { addPrimaryPlayerVerification } from './migrations/0004-add-primary-player-verification'
import * as legacyPlayerCollectionMigration from './migrations/0005-add-saved-players'
import { addPinnedPlayerShortcuts } from './migrations/0006-add-pinned-player-shortcuts'
import { addV2AccountsImportEvidence } from './migrations/0007-add-v2-accounts-import-evidence'
import { consolidatePinnedPlayers } from './migrations/0008-consolidate-pinned-players'
import { createAccounts } from './src/accounts'

export {
  importLegacyAccounts,
  type LegacyAccountsImportOptions,
  type LegacyAccountsImportResult,
  type LegacyAccountsReconciliation,
} from './src/legacy-import'

export { AccountsMaintenanceError, InvalidPinnedPlayerError, MAX_PINNED_PLAYERS } from './src/accounts'
import { createPostgresAccountsStore } from './src/postgres-store'

export function createPostgresAccounts(connectionString: string) {
  const { store, close } = createPostgresAccountsStore(connectionString)
  return {
    accounts: createAccounts({ store }),
    primaryMonitoring: { readSnapshot: store.readPrimaryMonitoringSnapshot },
    close,
  }
}

export const accountsMigrationInventory = [
  initializeAndImportV2Accounts,
  addV2AuthCutoverState,
  addAccountPreferences,
  addPrimaryPlayerVerification,
  Object.values(legacyPlayerCollectionMigration)[0],
  addPinnedPlayerShortcuts,
  addV2AccountsImportEvidence,
  consolidatePinnedPlayers,
] as const

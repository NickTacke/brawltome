import type { BrawltomeModule } from '@brawltome/foundation'
import { initializeAndImportV2Accounts } from './migrations/0001-initialize-and-import-v2'
import { addV2AuthCutoverState } from './migrations/0002-add-v2-auth-cutover-state'
import { addAccountPreferences } from './migrations/0003-add-preferences'
import { addPrimaryPlayerVerification } from './migrations/0004-add-primary-player-verification'
import * as legacyPlayerCollectionMigration from './migrations/0005-add-saved-players'
import { addPinnedPlayerShortcuts } from './migrations/0006-add-pinned-player-shortcuts'
import { addV2AccountsImportEvidence } from './migrations/0007-add-v2-accounts-import-evidence'
import { consolidatePinnedPlayers } from './migrations/0008-consolidate-pinned-players'
import { addAccountTheme } from './migrations/0009-add-account-theme'
import { createAccounts } from './src/accounts'
import { createPostgresAccountsStore } from './src/postgres-store'

export {
  ACCOUNT_THEMES,
  DEFAULT_ACCOUNT_PREFERENCES,
  InvalidAccountPreferencesError,
  InvalidPinnedPlayerError,
  MAX_PINNED_PLAYERS,
  type Account,
  type AccountAuthentication,
  type AccountPreferences,
  type AccountPreferencesUpdate,
  type Accounts,
  type AccountSignIn,
  type DiscordSignInProfile,
  type PinnedPlayer,
  type PlayerShortcuts,
  type PrimaryMonitoringSnapshot,
  type PrimaryMonitoringTarget,
  type PrimaryPlayer,
  type PrimaryPlayerEvidence,
  type PrimaryPlayerReference,
  type PrimaryPlayerVerificationAttempt,
  type PrimaryPlayerVerificationState,
  type PrimaryPlayerVerificationStatus,
} from './src/accounts'

export function createPostgresAccounts(connectionString: string) {
  const { store, readDemandedPlayerIds, close } = createPostgresAccountsStore(connectionString)
  return {
    accounts: createAccounts({ store }),
    primaryMonitoring: { readSnapshot: store.readPrimaryMonitoringSnapshot },
    demand: { readPlayerIds: readDemandedPlayerIds },
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
  addAccountTheme,
] as const

export const accountsModule = {
  name: 'accounts',
  dependsOn: [],
  migrations: accountsMigrationInventory,
} satisfies BrawltomeModule

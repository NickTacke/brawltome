import type { Accounts } from '@brawltome/accounts'
import type { Database, ObjectStore } from '@brawltome/foundation'

/** What every use case of the module needs. */
export type ReplaysDeps = {
  database: Database
  objectStore: ObjectStore
  accounts: Accounts
}

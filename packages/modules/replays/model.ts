import type { Accounts } from '@brawltome/accounts'
import type { Database, ObjectStore } from '@brawltome/foundation'

/** What every use case of the module needs. */
export type ReplaysDeps = {
  database: Database
  objectStore: ObjectStore
  // the public art bucket; null when this process has none, and then no art is exported
  artStore: ObjectStore | null
  accounts: Accounts
}

/** What the worker runs, sent with every claim; artFormat is null from a worker that can't export art. */
export type WorkerReport = { build: string; patches: string[]; artFormat: number | null }

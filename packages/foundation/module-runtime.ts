import type { Database } from './database'
import type { ObjectStore } from './object-store'

/** What a process hands its modules once at startup, so each can build its procedures. */
export type ModuleRuntime = {
  // no env: a module gets config through a named field here once it needs some, never the whole process env
  database: Database
  // where modules keep files outside Postgres (replay files and timelines); absent where no module needs it
  objectStore?: ObjectStore
  // accounts allowed to upload any replay, for testing (REPLAY_OPERATOR_ACCOUNTS)
  replayOperatorAccountIds?: readonly string[]
}

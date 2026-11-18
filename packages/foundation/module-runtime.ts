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
  // whether everyone sees replays and match pages; until then only the operators do (REPLAYS_OPEN)
  replaysOpen?: boolean
  // the public bucket of replay art and the address it is served at (ART_R2_BUCKET and ART_BASE_URL); absent where
  // there is none
  replayArt?: { store: ObjectStore; baseUrl: string }
}

import type { Database } from './database'

/** What a process hands its modules once at startup, so each can build its procedures. */
export type ModuleRuntime = {
  // no env: a module gets config through a named field here once it needs some, never the whole process env
  database: Database
}

import type { Database } from './database'

/** What a process hands its modules once at startup, so each can build its procedures. */
export type ModuleRuntime = {
  database: Database
  env: Readonly<Record<string, string | undefined>>
}

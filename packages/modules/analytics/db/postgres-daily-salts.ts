import type { Database } from '@brawltome/foundation'
import { ensureDailySalt } from './ensure-daily-salt'

/** The daily salt use case bound to one database, for the api's visitor keys. */
export function createPostgresDailySalts(database: Database) {
  return {
    saltFor: (day: string) => ensureDailySalt(database, day),
  }
}

export type PostgresDailySalts = ReturnType<typeof createPostgresDailySalts>

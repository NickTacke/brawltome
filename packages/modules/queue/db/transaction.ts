import type { Database } from '@brawltome/foundation'

/** A drizzle transaction on the shared client, as database.db.transaction hands it to its callback. */
export type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0]

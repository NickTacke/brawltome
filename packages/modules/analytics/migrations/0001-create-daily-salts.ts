const sql = `CREATE SCHEMA analytics;

CREATE UNLOGGED TABLE analytics.daily_salts (
  day date PRIMARY KEY,
  salt text NOT NULL CHECK (salt ~ '^[0-9a-f]{64}$')
) WITH (autovacuum_vacuum_threshold = 0, autovacuum_vacuum_scale_factor = 0);`

// a new schema and table only, so the release before this one runs unchanged against the migrated database.
// unlogged keeps the salt out of the write-ahead log; a crash empties the table and the day just gets a new salt.
// a deleted row stays readable in the table's file until it is vacuumed, and by default a table this small would
// wait for fifty of them, so it is vacuumed after every delete
export const createDailySalts = {
  identity: 'analytics/0001',
  predecessor: null,
  checksum: 'a2962ba0817a3330ea4ef8302caaa1eb5f31721d43f151377fba740ed6a186e3',
  sql,
} as const

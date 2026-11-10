const sql = `CREATE SCHEMA analytics;

CREATE UNLOGGED TABLE analytics.daily_salts (
  day date PRIMARY KEY,
  salt text NOT NULL CHECK (salt ~ '^[0-9a-f]{64}$')
);`

// a new schema and table only, so the release before this one runs unchanged against the migrated database.
// unlogged keeps the salt out of the write-ahead log; a crash empties the table and the day just gets a new salt
export const createDailySalts = {
  identity: 'analytics/0001',
  predecessor: null,
  checksum: '8d3043a42d6458b1a7709337de5762cd77e35cf4a2a13206526c9dab1ea19c9a',
  sql,
} as const

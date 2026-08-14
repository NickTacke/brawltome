const sql = `ALTER TABLE clans.members
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN rank DROP NOT NULL,
  ALTER COLUMN join_date DROP NOT NULL;`

export const allowSparseClanMembers = {
  identity: 'clans/0004',
  predecessor: 'clans/0003',
  checksum: '051bc3a18581cb2668e0b8282d9ace8fab5eb6ed35177e37d5a57e5b39e83e95',
  sql,
} as const

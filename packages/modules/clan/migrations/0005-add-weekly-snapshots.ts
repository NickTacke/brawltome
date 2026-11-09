const sql = `SET LOCAL lock_timeout = '5s';

CREATE TABLE clans.weekly_snapshot_runs (
  week_starting date PRIMARY KEY,
  last_clan_id integer NOT NULL DEFAULT 0 CHECK (last_clan_id >= 0),
  source_down_since timestamptz,
  completed_at timestamptz
);

CREATE TABLE clans.weekly_snapshots (
  week_starting date NOT NULL REFERENCES clans.weekly_snapshot_runs(week_starting) ON DELETE CASCADE,
  clan_id integer NOT NULL REFERENCES clans.clans(clan_id) ON DELETE CASCADE,
  guild_points numeric(40, 0) NOT NULL CHECK (guild_points >= 0),
  source_rank integer CHECK (source_rank > 0),
  taken_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (week_starting, clan_id)
);`

// new tables only, so the release before this one runs unchanged against the migrated database
export const addClanWeeklySnapshots = {
  identity: 'clans/0005',
  predecessor: 'clans/0004',
  checksum: '9954661b306e1e471c2af2e6b23067a088234271c2dd2294cef93d08150ff7a7',
  sql,
} as const

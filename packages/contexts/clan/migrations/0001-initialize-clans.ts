const sql = `CREATE SCHEMA clans;

CREATE TABLE clans.clans (
  clan_id integer PRIMARY KEY CHECK (clan_id > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE clans.profiles (
  clan_id integer PRIMARY KEY REFERENCES clans.clans(clan_id) ON DELETE CASCADE,
  clan_name text NOT NULL,
  clan_create_date timestamptz NOT NULL,
  clan_xp numeric(40, 0) NOT NULL CHECK (clan_xp >= 0),
  clan_lifetime_xp numeric(41, 0) NOT NULL CHECK (clan_lifetime_xp >= 0),
  notice text,
  tags jsonb,
  discord_invite_code text,
  guild_points numeric(40, 0) CHECK (guild_points >= 0),
  is_recruiting boolean
);

CREATE TABLE clans.profile_state (
  clan_id integer PRIMARY KEY REFERENCES clans.clans(clan_id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL,
  check_provenance jsonb NOT NULL,
  last_success_at timestamptz,
  last_success_provenance jsonb,
  CHECK (last_success_at IS NULL OR last_success_at <= checked_at),
  CHECK ((last_success_at IS NULL) = (last_success_provenance IS NULL))
);

CREATE TABLE clans.roster_state (
  clan_id integer PRIMARY KEY REFERENCES clans.clans(clan_id) ON DELETE CASCADE,
  checked_at timestamptz,
  check_provenance jsonb NOT NULL,
  last_success_at timestamptz,
  last_success_provenance jsonb,
  CHECK (last_success_at IS NULL OR checked_at IS NULL OR last_success_at <= checked_at),
  CHECK ((last_success_at IS NULL) = (last_success_provenance IS NULL))
);

CREATE TABLE clans.members (
  clan_id integer NOT NULL REFERENCES clans.clans(clan_id) ON DELETE CASCADE,
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  name text NOT NULL,
  rank text NOT NULL,
  join_date timestamptz NOT NULL,
  xp numeric(40, 0) NOT NULL CHECK (xp >= 0),
  guild_points numeric(40, 0) CHECK (guild_points >= 0),
  observed_at timestamptz,
  PRIMARY KEY (clan_id, brawlhalla_id),
  UNIQUE (brawlhalla_id)
);
CREATE INDEX clans_members_clan_order ON clans.members (clan_id, xp DESC, brawlhalla_id);

CREATE TABLE clans.refresh_effects (
  operation_id uuid NOT NULL,
  section text NOT NULL CHECK (section IN ('profile', 'roster')),
  lease_token bigint NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  applied_at timestamptz,
  PRIMARY KEY (operation_id, section)
);

CREATE TABLE clans.legacy_archive (
  source_table text NOT NULL,
  source_key text NOT NULL,
  raw_row jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key)
);

CREATE TABLE clans.import_conflicts (
  conflict_key text PRIMARY KEY,
  conflict_kind text NOT NULL,
  source_rows jsonb NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);`

export const initializeClans = {
  identity: 'clans/0001',
  predecessor: null,
  checksum: 'f258dd4e3e46c8bcaa917f3f42a3d4a9925963374453e7c7c7b70565ea502700',
  sql,
} as const

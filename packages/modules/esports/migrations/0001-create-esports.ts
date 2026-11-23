const sql = `CREATE SCHEMA esports;

CREATE TABLE esports.players (
  brawlhalla_id bigint PRIMARY KEY,
  brawltools_player_id integer,
  brawltools_name text,
  link text NOT NULL CHECK (link IN ('linked', 'none')),
  pr_1v1 jsonb,
  pr_2v2 jsonb,
  event_legends jsonb NOT NULL DEFAULT '[]',
  checked_at timestamptz NOT NULL,
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);

CREATE TABLE esports.placements (
  brawlhalla_id bigint NOT NULL,
  mode smallint NOT NULL CHECK (mode IN (1, 2)),
  tournament_id text NOT NULL,
  tournament_name text NOT NULL,
  is_official boolean NOT NULL,
  is_online boolean NOT NULL,
  start_time timestamptz NOT NULL,
  placement integer NOT NULL CHECK (placement > 0),
  PRIMARY KEY (brawlhalla_id, mode, tournament_id)
);

CREATE TABLE esports.event_sets (
  brawlhalla_id bigint NOT NULL,
  tournament_id text NOT NULL,
  sets jsonb NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (brawlhalla_id, tournament_id)
);`

// a new schema and tables only, so the release before this one runs unchanged against the migrated database.
// pr_1v1 and pr_2v2 hold the raw { earnings, pr } object; event_sets.sets holds the raw playerMatches
export const createEsports = {
  identity: 'esports/0001',
  predecessor: null,
  checksum: 'd93c8ccee1e425f1ed888f5f9ebe4d196a7eb781b35de3fad6f70ae307ba9d29',
  sql,
} as const

const sql = `CREATE SCHEMA discovery;

CREATE TABLE discovery.player_generations (
  generation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  built_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  active boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX discovery_one_active_player_generation
  ON discovery.player_generations (active) WHERE active;

CREATE TABLE discovery.player_terms (
  generation_id uuid NOT NULL REFERENCES discovery.player_generations(generation_id) ON DELETE CASCADE,
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  term_kind text NOT NULL CHECK (term_kind IN ('canonical', 'segment', 'alias')),
  display_term text NOT NULL,
  normalized_term text COLLATE "C" NOT NULL,
  canonical_name text NOT NULL,
  region text,
  rating integer CHECK (rating >= 0),
  view_count integer NOT NULL CHECK (view_count >= 0),
  best_legend_name_key text,
  PRIMARY KEY (generation_id, brawlhalla_id, term_kind, normalized_term)
);
CREATE INDEX discovery_player_terms_prefix
  ON discovery.player_terms (generation_id, normalized_term);

CREATE TABLE discovery.player_event_receipts (
  event_id uuid PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE discovery.player_projection_effects (
  operation_id uuid PRIMARY KEY,
  source_version bigint NOT NULL CHECK (source_version >= 0),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at timestamptz
);

INSERT INTO discovery.player_generations (active) VALUES (true);`

export const initializeDiscovery = {
  identity: 'discovery/0001',
  predecessor: null,
  checksum: 'c3b9e880208831ee1be1fe8a27c733f0ec17e4df03435e39d811d264e9b51707',
  sql,
} as const

const sql = `CREATE TABLE players.discovery_aliases (
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  normalized_alias text NOT NULL,
  display_alias text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (brawlhalla_id, normalized_alias)
);

CREATE TABLE players.discovery_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0)
);
INSERT INTO players.discovery_state DEFAULT VALUES;

CREATE TABLE players.discovery_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  source_version bigint NOT NULL CHECK (source_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz
);
CREATE INDEX players_discovery_outbox_pending
  ON players.discovery_outbox (created_at, event_id) WHERE delivered_at IS NULL;

CREATE FUNCTION players.enqueue_discovery_fact() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  next_version bigint;
BEGIN
  UPDATE players.discovery_state
  SET source_version = source_version + 1
  WHERE singleton
  RETURNING source_version INTO next_version;

  INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
  VALUES (COALESCE(NEW.brawlhalla_id, OLD.brawlhalla_id), next_version);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER players_ranked_profiles_discovery_outbox_write
AFTER INSERT OR DELETE ON players.ranked_profiles
FOR EACH ROW EXECUTE FUNCTION players.enqueue_discovery_fact();
CREATE TRIGGER players_ranked_profiles_discovery_outbox_update
AFTER UPDATE OF player_name, region, rating, ranked_main_legend_name_key ON players.ranked_profiles
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION players.enqueue_discovery_fact();

CREATE TRIGGER players_discovery_aliases_outbox_write
AFTER INSERT OR DELETE ON players.discovery_aliases
FOR EACH ROW EXECUTE FUNCTION players.enqueue_discovery_fact();
CREATE TRIGGER players_discovery_aliases_outbox_update
AFTER UPDATE ON players.discovery_aliases
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION players.enqueue_discovery_fact();

DO $$
BEGIN
  IF to_regclass('public.player') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER player_discovery_outbox_write
      AFTER INSERT OR DELETE ON public.player
      FOR EACH ROW EXECUTE FUNCTION players.enqueue_discovery_fact()';
    EXECUTE 'CREATE TRIGGER player_discovery_outbox_update
      AFTER UPDATE OF name, region, rating, view_count ON public.player
      FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
      EXECUTE FUNCTION players.enqueue_discovery_fact()';
  END IF;
  IF to_regclass('public.player_alias') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER player_alias_discovery_outbox_write
      AFTER INSERT OR DELETE ON public.player_alias
      FOR EACH ROW EXECUTE FUNCTION players.enqueue_discovery_fact()';
    EXECUTE 'CREATE TRIGGER player_alias_discovery_outbox_update
      AFTER UPDATE ON public.player_alias
      FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
      EXECUTE FUNCTION players.enqueue_discovery_fact()';
  END IF;
END;
$$;

DO $$
DECLARE
  bootstrap_version bigint;
  legacy_players_exist boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM players.ranked_profiles) THEN
    UPDATE players.discovery_state SET source_version = source_version + 1
    WHERE singleton RETURNING source_version INTO bootstrap_version;
    INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
    SELECT brawlhalla_id, bootstrap_version FROM players.ranked_profiles;
  END IF;

  IF to_regclass('public.player') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.player)' INTO legacy_players_exist;
  END IF;
  IF legacy_players_exist THEN
    UPDATE players.discovery_state SET source_version = source_version + 1
    WHERE singleton RETURNING source_version INTO bootstrap_version;
    EXECUTE format(
      'INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
       SELECT brawlhalla_id, %L FROM public.player',
      bootstrap_version
    );
  END IF;
END;
$$;`

export const addDiscoveryFacts = {
  identity: 'players/0005',
  predecessor: 'players/0004',
  checksum: '4d2f348303b8be6e467479c9f4cbb00bdbb343f643c04ae408fd218fdfa9e1c4',
  sql,
} as const

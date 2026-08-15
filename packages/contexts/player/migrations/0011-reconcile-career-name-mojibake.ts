const sql = `SET LOCAL lock_timeout = '5s';

LOCK TABLE players.career_profiles, players.discovery_aliases IN SHARE ROW EXCLUSIVE MODE;

SELECT set_config('players.suppress_discovery_outbox', 'on', true);

CREATE TEMP TABLE players_0011_name_evidence (
  brawlhalla_id integer NOT NULL,
  player_name text NOT NULL,
  PRIMARY KEY (brawlhalla_id, player_name)
) ON COMMIT DROP;

CREATE TEMP TABLE players_0011_career_repairs (
  brawlhalla_id integer PRIMARY KEY,
  stored_name text NOT NULL,
  repaired_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE players_0011_alias_deletions (
  brawlhalla_id integer NOT NULL,
  normalized_alias text NOT NULL,
  PRIMARY KEY (brawlhalla_id, normalized_alias)
) ON COMMIT DROP;

INSERT INTO players_0011_name_evidence (brawlhalla_id, player_name)
SELECT brawlhalla_id, player_name
FROM players.career_profiles
WHERE last_success_at IS NOT NULL AND player_name IS NOT NULL
UNION
SELECT brawlhalla_id, player_name
FROM players.ranked_profiles
WHERE last_success_at IS NOT NULL AND player_name IS NOT NULL
UNION
SELECT brawlhalla_id, display_alias FROM players.discovery_aliases
UNION
SELECT brawlhalla_id, player_name FROM players.legacy_discovery_profiles
UNION
SELECT brawlhalla_id, display_alias FROM players.legacy_discovery_aliases
UNION
SELECT brawlhalla_id, player_name FROM players.legacy_profile_discovery;

INSERT INTO players_0011_career_repairs (brawlhalla_id, stored_name, repaired_name)
SELECT profile.brawlhalla_id, profile.player_name, evidence.player_name
FROM players.career_profiles profile
JOIN players_0011_name_evidence evidence USING (brawlhalla_id)
WHERE profile.last_success_at IS NOT NULL
  AND profile.player_name IS DISTINCT FROM evidence.player_name
  AND profile.player_name = convert_from(convert_to(evidence.player_name, 'UTF8'), 'LATIN1')
  AND evidence.player_name !~ U&'[\\00C2-\\00F4][\\0080-\\00BF]';

INSERT INTO players_0011_alias_deletions (brawlhalla_id, normalized_alias)
SELECT alias.brawlhalla_id, alias.normalized_alias
FROM players.discovery_aliases alias
JOIN players_0011_career_repairs repair USING (brawlhalla_id)
WHERE alias.display_alias = repair.stored_name;

UPDATE players.career_profiles profile
SET player_name = repair.repaired_name
FROM players_0011_career_repairs repair
WHERE profile.brawlhalla_id = repair.brawlhalla_id;

DELETE FROM players.discovery_aliases alias
USING players_0011_alias_deletions deletion
WHERE alias.brawlhalla_id = deletion.brawlhalla_id
  AND alias.normalized_alias = deletion.normalized_alias;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM players_0011_career_repairs)
    AND NOT EXISTS (SELECT 1 FROM players.discovery_state WHERE singleton)
  THEN
    RAISE EXCEPTION 'Players Discovery state singleton is missing';
  END IF;
END;
$$;

WITH version AS (
  UPDATE players.discovery_state
  SET source_version = source_version + 1
  WHERE singleton AND EXISTS (SELECT 1 FROM players_0011_career_repairs)
  RETURNING source_version
)
INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
SELECT repair.brawlhalla_id, version.source_version
FROM players_0011_career_repairs repair CROSS JOIN version
ORDER BY repair.brawlhalla_id;
`

export const reconcileCareerNameMojibake = {
  identity: 'players/0011',
  predecessor: 'players/0010',
  checksum: '9d5c966abe89503203f0aab81520d6177dc9654fd80b387509486ab0050b91a2',
  sql,
} as const

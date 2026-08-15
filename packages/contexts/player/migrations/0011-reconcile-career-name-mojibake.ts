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

CREATE TEMP TABLE players_0011_alias_repairs (
  brawlhalla_id integer NOT NULL,
  normalized_alias text NOT NULL,
  repaired_name text NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (brawlhalla_id, normalized_alias)
) ON COMMIT DROP;

CREATE TEMP TABLE players_0011_affected (
  brawlhalla_id integer PRIMARY KEY
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

INSERT INTO players_0011_name_evidence (brawlhalla_id, player_name)
SELECT brawlhalla_id, repaired_name FROM players_0011_career_repairs
ON CONFLICT DO NOTHING;

INSERT INTO players_0011_alias_repairs (brawlhalla_id, normalized_alias, repaired_name, observed_at)
SELECT alias.brawlhalla_id, alias.normalized_alias, evidence.player_name, alias.observed_at
FROM players.discovery_aliases alias
JOIN players_0011_name_evidence evidence USING (brawlhalla_id)
WHERE alias.display_alias IS DISTINCT FROM evidence.player_name
  AND alias.display_alias = convert_from(convert_to(evidence.player_name, 'UTF8'), 'LATIN1')
  AND evidence.player_name !~ U&'[\\00C2-\\00F4][\\0080-\\00BF]';

INSERT INTO players_0011_affected (brawlhalla_id)
SELECT brawlhalla_id FROM players_0011_career_repairs
UNION
SELECT brawlhalla_id FROM players_0011_alias_repairs;

UPDATE players.career_profiles profile
SET player_name = repair.repaired_name
FROM players_0011_career_repairs repair
WHERE profile.brawlhalla_id = repair.brawlhalla_id;

DELETE FROM players.discovery_aliases alias
USING players_0011_alias_repairs repair
WHERE alias.brawlhalla_id = repair.brawlhalla_id
  AND alias.normalized_alias = repair.normalized_alias;

INSERT INTO players.discovery_aliases (brawlhalla_id, normalized_alias, display_alias, observed_at)
SELECT winner.brawlhalla_id, winner.normalized_alias, winner.repaired_name, winner.observed_at
FROM (
  SELECT repair.brawlhalla_id,
         lower(repair.repaired_name) AS normalized_alias,
         repair.repaired_name,
         repair.observed_at,
         row_number() OVER (
           PARTITION BY repair.brawlhalla_id, lower(repair.repaired_name)
           ORDER BY repair.observed_at DESC,
                    repair.normalized_alias COLLATE "C",
                    repair.repaired_name COLLATE "C"
         ) AS priority
  FROM players_0011_alias_repairs repair
  WHERE NOT EXISTS (
    SELECT 1 FROM players.career_profiles profile
    WHERE profile.brawlhalla_id = repair.brawlhalla_id
      AND profile.player_name = repair.repaired_name
  )
) winner
WHERE winner.priority = 1
ON CONFLICT (brawlhalla_id, normalized_alias) DO UPDATE
SET display_alias = CASE
      WHEN EXCLUDED.observed_at > players.discovery_aliases.observed_at THEN EXCLUDED.display_alias
      WHEN EXCLUDED.observed_at < players.discovery_aliases.observed_at THEN players.discovery_aliases.display_alias
      ELSE LEAST(
        EXCLUDED.display_alias COLLATE "C",
        players.discovery_aliases.display_alias COLLATE "C"
      )
    END,
    observed_at = GREATEST(players.discovery_aliases.observed_at, EXCLUDED.observed_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM players_0011_affected)
    AND NOT EXISTS (SELECT 1 FROM players.discovery_state WHERE singleton)
  THEN
    RAISE EXCEPTION 'Players Discovery state singleton is missing';
  END IF;
END;
$$;

WITH version AS (
  UPDATE players.discovery_state
  SET source_version = source_version + 1
  WHERE singleton AND EXISTS (SELECT 1 FROM players_0011_affected)
  RETURNING source_version
)
INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
SELECT affected.brawlhalla_id, version.source_version
FROM players_0011_affected affected CROSS JOIN version
ORDER BY affected.brawlhalla_id;
`

export const reconcileCareerNameMojibake = {
  identity: 'players/0011',
  predecessor: 'players/0010',
  checksum: '01dcc60e1d530d7fe4806ab7532c107adeda8bdf3a5bea08e7d24423e2fc0d2a',
  sql,
} as const

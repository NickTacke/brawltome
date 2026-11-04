const sql = `ALTER TABLE rankings.generations
  ADD COLUMN mode text NOT NULL DEFAULT '1v1'
    CHECK (mode IN ('1v1', '2v2', 'solo2v2', '3v3'));
ALTER TABLE rankings.generations ALTER COLUMN mode DROP DEFAULT;
ALTER TABLE rankings.generations
  ADD COLUMN finalized boolean NOT NULL DEFAULT true;
ALTER TABLE rankings.generations ALTER COLUMN finalized DROP DEFAULT;
ALTER TABLE rankings.generations ADD CONSTRAINT generations_id_mode_unique UNIQUE (id, mode);
CREATE INDEX rankings_latest_generation_by_mode
  ON rankings.generations (mode, schedule_window_at DESC, id DESC);

DROP TRIGGER generations_are_immutable ON rankings.generations;
CREATE FUNCTION rankings.reject_generation_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT OLD.finalized AND NEW.finalized THEN
    NEW.finalized := false;
    IF NEW IS NOT DISTINCT FROM OLD THEN
      NEW.finalized := true;
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'published ranking snapshots are immutable';
END;
$$;
CREATE TRIGGER generations_are_immutable
BEFORE UPDATE OR DELETE ON rankings.generations
FOR EACH ROW EXECUTE FUNCTION rankings.reject_generation_change();

CREATE FUNCTION rankings.require_unfinalized_generation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  generation_finalized boolean;
BEGIN
  SELECT finalized INTO generation_finalized
  FROM rankings.generations
  WHERE id = NEW.generation_id AND mode = NEW.mode
  FOR UPDATE;
  IF generation_finalized IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'published ranking snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE rankings.snapshots
  ADD COLUMN mode text NOT NULL DEFAULT '1v1'
    CHECK (mode IN ('1v1', '2v2', 'solo2v2', '3v3'));
ALTER TABLE rankings.snapshots ALTER COLUMN mode DROP DEFAULT;
ALTER TABLE rankings.snapshots DROP CONSTRAINT snapshots_generation_id_fkey;
ALTER TABLE rankings.snapshots
  ADD CONSTRAINT snapshots_generation_mode_fkey
  FOREIGN KEY (generation_id, mode) REFERENCES rankings.generations(id, mode);
ALTER TABLE rankings.snapshots DROP CONSTRAINT snapshots_generation_id_scope_key;
ALTER TABLE rankings.snapshots ADD CONSTRAINT snapshots_generation_mode_scope_key UNIQUE (generation_id, mode, scope);
CREATE INDEX rankings_snapshot_mode_scope ON rankings.snapshots (mode, scope, generation_id);
ALTER TABLE rankings.snapshots ADD CONSTRAINT snapshots_id_mode_unique UNIQUE (id, mode);
CREATE TRIGGER snapshots_require_unfinalized_generation
BEFORE INSERT ON rankings.snapshots
FOR EACH ROW EXECUTE FUNCTION rankings.require_unfinalized_generation();

ALTER TABLE rankings.snapshot_rows RENAME COLUMN brawlhalla_id TO player_one_id;
ALTER TABLE rankings.snapshot_rows RENAME COLUMN name TO player_one_name;
ALTER TABLE rankings.snapshot_rows
  ADD COLUMN mode text NOT NULL DEFAULT '1v1'
    CHECK (mode IN ('1v1', '2v2', 'solo2v2', '3v3')),
  ADD COLUMN identity_kind text NOT NULL DEFAULT 'one-vs-one-player'
    CHECK (identity_kind IN (
      'one-vs-one-player', 'fixed-two-vs-two-team',
      'solo-two-vs-two-player', 'three-vs-three-player'
    )),
  ADD COLUMN player_two_id integer,
  ADD COLUMN player_two_name text;
ALTER TABLE rankings.snapshot_rows ALTER COLUMN mode DROP DEFAULT;
ALTER TABLE rankings.snapshot_rows ALTER COLUMN identity_kind DROP DEFAULT;
ALTER TABLE rankings.snapshot_rows DROP CONSTRAINT snapshot_rows_snapshot_id_fkey;
ALTER TABLE rankings.snapshot_rows
  ADD CONSTRAINT snapshot_rows_snapshot_mode_fkey
  FOREIGN KEY (snapshot_id, mode) REFERENCES rankings.snapshots(id, mode);
ALTER TABLE rankings.snapshot_rows DROP CONSTRAINT snapshot_rows_snapshot_id_brawlhalla_id_key;
ALTER TABLE rankings.snapshot_rows
  ADD COLUMN identity_key text GENERATED ALWAYS AS (
    CASE
      WHEN identity_kind = 'fixed-two-vs-two-team' THEN player_one_id::text || ':' || player_two_id::text
      ELSE player_one_id::text
    END
  ) STORED;
ALTER TABLE rankings.snapshot_rows
  ADD CONSTRAINT snapshot_rows_snapshot_identity_key UNIQUE (snapshot_id, identity_key),
  ADD CONSTRAINT snapshot_rows_mode_identity_check CHECK (
    (mode = '1v1' AND identity_kind = 'one-vs-one-player')
    OR (mode = '2v2' AND identity_kind = 'fixed-two-vs-two-team')
    OR (mode = 'solo2v2' AND identity_kind = 'solo-two-vs-two-player')
    OR (mode = '3v3' AND identity_kind = 'three-vs-three-player')
  ),
  ADD CONSTRAINT snapshot_rows_contestants_check CHECK (
    player_one_id > 0
    AND length(player_one_name) > 0
    AND (
      (identity_kind = 'fixed-two-vs-two-team'
        AND player_two_id IS NOT NULL
        AND player_two_id > player_one_id
        AND player_two_name IS NOT NULL
        AND length(player_two_name) > 0)
      OR
      (identity_kind <> 'fixed-two-vs-two-team'
        AND player_two_id IS NULL
        AND player_two_name IS NULL)
    )
  );
CREATE INDEX rankings_snapshot_rows_mode_standing ON rankings.snapshot_rows (snapshot_id, mode, standing);

CREATE FUNCTION rankings.require_unfinalized_snapshot_generation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  generation_finalized boolean;
BEGIN
  SELECT generation.finalized INTO generation_finalized
  FROM rankings.snapshots snapshot
  JOIN rankings.generations generation
    ON generation.id = snapshot.generation_id AND generation.mode = snapshot.mode
  WHERE snapshot.id = NEW.snapshot_id AND snapshot.mode = NEW.mode
  FOR UPDATE OF generation;
  IF generation_finalized IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'published ranking snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER snapshot_rows_require_unfinalized_generation
BEFORE INSERT ON rankings.snapshot_rows
FOR EACH ROW EXECUTE FUNCTION rankings.require_unfinalized_snapshot_generation();

ALTER TABLE rankings.collection_failures
  ADD COLUMN mode text NOT NULL DEFAULT '1v1'
    CHECK (mode IN ('1v1', '2v2', 'solo2v2', '3v3')),
  ADD COLUMN scope text NOT NULL DEFAULT 'all'
    CHECK (scope IN ('all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'));
ALTER TABLE rankings.collection_failures ALTER COLUMN mode DROP DEFAULT;
ALTER TABLE rankings.collection_failures ALTER COLUMN scope DROP DEFAULT;
CREATE INDEX rankings_latest_collection_failure_by_mode_scope
  ON rankings.collection_failures (mode, scope, schedule_window_at DESC, checked_at DESC, id DESC);`

export const addSupportedLeaderboardModes = {
  identity: 'rankings/0002',
  predecessor: 'rankings/0001',
  checksum: 'ad02e3418fd523a88541aec0c6b1d0c1c38f87b3c4a20bd76f5dfb64e3bbb9bd',
  sql,
} as const

const sql = `CREATE TABLE statistics.career_weapon_usage_snapshots (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL UNIQUE REFERENCES statistics.cohort_generations(id),
  cohort_methodology_version text NOT NULL CHECK (length(cohort_methodology_version) BETWEEN 1 AND 200),
  methodology_version text NOT NULL CHECK (methodology_version = 'career-weapon-usage-v1'),
  publication_decision_id uuid NOT NULL UNIQUE,
  published_at timestamptz NOT NULL,
  sealed_at timestamptz
);

CREATE TABLE statistics.career_weapon_usage_scopes (
  snapshot_id uuid NOT NULL REFERENCES statistics.career_weapon_usage_snapshots(id),
  region text NOT NULL CHECK (region IN ('all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')),
  bracket text NOT NULL CHECK (bracket IN ('all', 'Platinum', 'Diamond+')),
  selected_players integer NOT NULL CHECK (selected_players >= 0),
  successful_observations integer NOT NULL CHECK (
    successful_observations >= 0 AND successful_observations <= selected_players
  ),
  total_held_seconds numeric(30, 0) NOT NULL CHECK (total_held_seconds >= 0),
  PRIMARY KEY (snapshot_id, region, bracket)
);

CREATE TABLE statistics.career_weapon_usage_rows (
  snapshot_id uuid NOT NULL,
  region text NOT NULL,
  bracket text NOT NULL,
  weapon text NOT NULL CHECK (length(weapon) BETWEEN 1 AND 100),
  observed_players integer NOT NULL CHECK (observed_players >= 0),
  held_time_seconds numeric(30, 0) NOT NULL CHECK (held_time_seconds >= 0),
  contributor_count integer NOT NULL CHECK (contributor_count >= 0),
  qualifying_held_seconds numeric(30, 0) NOT NULL CHECK (qualifying_held_seconds >= 0),
  median_damage_numerator numeric(40, 0),
  median_damage_denominator numeric(40, 0),
  median_kos_numerator numeric(40, 0),
  median_kos_denominator numeric(40, 0),
  comparison_eligible boolean NOT NULL,
  comparison_reasons jsonb NOT NULL CHECK (jsonb_typeof(comparison_reasons) = 'array'),
  PRIMARY KEY (snapshot_id, region, bracket, weapon),
  FOREIGN KEY (snapshot_id, region, bracket)
    REFERENCES statistics.career_weapon_usage_scopes(snapshot_id, region, bracket),
  CHECK ((median_damage_numerator IS NULL) = (median_damage_denominator IS NULL)),
  CHECK ((median_kos_numerator IS NULL) = (median_kos_denominator IS NULL)),
  CHECK (median_damage_numerator IS NULL OR median_damage_numerator >= 0),
  CHECK (median_kos_numerator IS NULL OR median_kos_numerator >= 0),
  CHECK (median_damage_denominator IS NULL OR median_damage_denominator > 0),
  CHECK (median_kos_denominator IS NULL OR median_kos_denominator > 0),
  CHECK (comparison_eligible = (
    median_damage_numerator IS NOT NULL
    AND median_kos_numerator IS NOT NULL
    AND comparison_reasons = '[]'::jsonb
  ))
);

CREATE FUNCTION statistics.validate_career_weapon_usage_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM statistics.publication_decisions decision
    WHERE decision.id = NEW.publication_decision_id
      AND decision.generation_id = NEW.generation_id
      AND decision.product = 'lifetime'
      AND decision.decision = 'accepted'
      AND decision.decided_at = NEW.published_at
  ) THEN
    RAISE EXCEPTION 'Career Weapon Usage snapshot requires its accepted lifetime publication decision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION statistics.seal_career_weapon_usage_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed_at IS NULL
    AND NEW.sealed_at IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.generation_id = OLD.generation_id
    AND NEW.publication_decision_id = OLD.publication_decision_id
    AND NEW.published_at = OLD.published_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'statistics cohort evidence is immutable';
END;
$$;

CREATE FUNCTION statistics.reject_sealed_career_weapon_usage_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM statistics.career_weapon_usage_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id AND snapshot.sealed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'statistics cohort evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER career_weapon_usage_snapshot_identity
BEFORE INSERT ON statistics.career_weapon_usage_snapshots
FOR EACH ROW EXECUTE FUNCTION statistics.validate_career_weapon_usage_snapshot();
CREATE TRIGGER career_weapon_usage_snapshot_seal
BEFORE UPDATE ON statistics.career_weapon_usage_snapshots
FOR EACH ROW EXECUTE FUNCTION statistics.seal_career_weapon_usage_snapshot();
CREATE TRIGGER career_weapon_usage_snapshots_delete_immutable
BEFORE DELETE ON statistics.career_weapon_usage_snapshots
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER career_weapon_usage_scopes_insert_immutable
BEFORE INSERT ON statistics.career_weapon_usage_scopes
FOR EACH ROW EXECUTE FUNCTION statistics.reject_sealed_career_weapon_usage_insert();
CREATE TRIGGER career_weapon_usage_rows_insert_immutable
BEFORE INSERT ON statistics.career_weapon_usage_rows
FOR EACH ROW EXECUTE FUNCTION statistics.reject_sealed_career_weapon_usage_insert();
CREATE TRIGGER career_weapon_usage_scopes_immutable
BEFORE UPDATE OR DELETE ON statistics.career_weapon_usage_scopes
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER career_weapon_usage_rows_immutable
BEFORE UPDATE OR DELETE ON statistics.career_weapon_usage_rows
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER career_weapon_usage_snapshots_truncate_immutable
BEFORE TRUNCATE ON statistics.career_weapon_usage_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER career_weapon_usage_scopes_truncate_immutable
BEFORE TRUNCATE ON statistics.career_weapon_usage_scopes
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER career_weapon_usage_rows_truncate_immutable
BEFORE TRUNCATE ON statistics.career_weapon_usage_rows
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();`

export const addCareerWeaponUsage = {
  identity: 'statistics/0004',
  predecessor: 'statistics/0003',
  checksum: '00422dc3fcbd2053c6922587aa4531fcaecdeb9c80e8d189545747bc9b3501a8',
  sql,
} as const

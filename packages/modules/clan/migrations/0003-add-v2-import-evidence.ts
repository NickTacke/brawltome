const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE clans.legacy_archive
  ADD COLUMN brawlhalla_id integer,
  ADD COLUMN row_checksum char(64),
  ADD COLUMN content_checksum char(64);
DO $canonicalize$
BEGIN
  IF to_regclass('public.clan') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE clans.legacy_archive archive
      SET raw_row = to_jsonb(source), brawlhalla_id = NULL
      FROM public.clan source
      WHERE archive.source_table = 'clan' AND archive.source_key = source.clan_id::text
    $sql$;
  END IF;
  IF to_regclass('public.clan_member') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE clans.legacy_archive archive
      SET raw_row = to_jsonb(source), brawlhalla_id = source.brawlhalla_id
      FROM public.clan_member source
      WHERE archive.source_table = 'clan_member'
        AND archive.source_key = source.clan_id::text || ':' || source.brawlhalla_id::text
    $sql$;
  END IF;
  IF to_regclass('public.player_clan') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE clans.legacy_archive archive
      SET raw_row = to_jsonb(source), brawlhalla_id = source.brawlhalla_id
      FROM public.player_clan source
      WHERE archive.source_table = 'player_clan' AND archive.source_key = source.brawlhalla_id::text
    $sql$;
  END IF;
END;
$canonicalize$;
UPDATE clans.legacy_archive
SET row_checksum = encode(sha256(convert_to(raw_row::text, 'UTF8')), 'hex'),
    content_checksum = encode(sha256(convert_to(raw_row::text, 'UTF8')), 'hex');
ALTER TABLE clans.legacy_archive
  ALTER COLUMN row_checksum SET NOT NULL,
  ALTER COLUMN content_checksum SET NOT NULL,
  ADD CONSTRAINT clans_legacy_archive_row_checksum_check
    CHECK (row_checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT clans_legacy_archive_content_checksum_check
    CHECK (content_checksum ~ '^[0-9a-f]{64}$');
CREATE INDEX clans_legacy_archive_identity ON clans.legacy_archive (brawlhalla_id, source_table);

CREATE FUNCTION clans.reject_legacy_migration_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Clans legacy migration evidence is immutable';
END;
$$;
CREATE TRIGGER clans_legacy_archive_immutable
BEFORE UPDATE OR DELETE ON clans.legacy_archive
FOR EACH ROW EXECUTE FUNCTION clans.reject_legacy_migration_evidence_change();
CREATE TRIGGER clans_legacy_archive_prevent_truncate
BEFORE TRUNCATE ON clans.legacy_archive
FOR EACH STATEMENT EXECUTE FUNCTION clans.reject_legacy_migration_evidence_change();

CREATE TABLE clans.legacy_import_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  status text NOT NULL CHECK (status IN ('in-progress', 'complete', 'blocked')),
  stage text NOT NULL CHECK (stage = 'clans'),
  last_clan_id integer,
  source_manifest jsonb NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL))
);

CREATE TABLE clans.legacy_import_ledger (
  source_table text NOT NULL,
  source_key text NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('transformed', 'rejected')),
  transformed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key),
  FOREIGN KEY (source_table, source_key)
    REFERENCES clans.legacy_archive(source_table, source_key)
);

CREATE TABLE clans.legacy_import_rejections (
  source_table text NOT NULL,
  source_key text NOT NULL,
  code text NOT NULL,
  evidence jsonb NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  rejected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key, code)
);
CREATE TRIGGER clans_legacy_import_ledger_immutable
BEFORE UPDATE OR DELETE ON clans.legacy_import_ledger
FOR EACH ROW EXECUTE FUNCTION clans.reject_legacy_migration_evidence_change();
CREATE TRIGGER clans_legacy_import_rejections_immutable
BEFORE UPDATE OR DELETE ON clans.legacy_import_rejections
FOR EACH ROW EXECUTE FUNCTION clans.reject_legacy_migration_evidence_change();
CREATE TRIGGER clans_legacy_import_ledger_prevent_truncate
BEFORE TRUNCATE ON clans.legacy_import_ledger
FOR EACH STATEMENT EXECUTE FUNCTION clans.reject_legacy_migration_evidence_change();
CREATE TRIGGER clans_legacy_import_rejections_prevent_truncate
BEFORE TRUNCATE ON clans.legacy_import_rejections
FOR EACH STATEMENT EXECUTE FUNCTION clans.reject_legacy_migration_evidence_change();`

export const addV2ClanImportEvidence = {
  identity: 'clans/0003',
  predecessor: 'clans/0002',
  checksum: 'c4ec614b13c183791bd75315cc2c286a39dd551c86e4ab22ceb2405c994dba9a',
  sql,
} as const

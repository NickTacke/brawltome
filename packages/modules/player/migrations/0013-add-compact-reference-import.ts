const sql = `ALTER TABLE players.ranked_rating_history ALTER COLUMN tier DROP NOT NULL;
ALTER TABLE players.ranked_rating_history
  ADD CONSTRAINT players_ranked_history_canonical_tier
    CHECK (history_source = 'v2-legacy' OR tier IS NOT NULL);

CREATE UNIQUE INDEX players_ranked_history_legacy_source_key
  ON players.ranked_rating_history (legacy_source_key)
  WHERE history_source = 'v2-legacy';

DELETE FROM players.legacy_import_rejections rejection
USING players.legacy_archive archive
WHERE rejection.source_table = 'rating_history'
  AND rejection.source_table = archive.source_table
  AND rejection.source_key = archive.source_key
  AND EXISTS (
    SELECT 1 FROM players.legacy_import_rejections prior
    WHERE prior.source_table = rejection.source_table
      AND prior.source_key = rejection.source_key
      AND prior.code = 'history-tier-unavailable'
  )
  AND archive.raw_row->'tier' = 'null'::jsonb;
DELETE FROM players.legacy_import_ledger ledger
USING players.legacy_archive archive
WHERE ledger.source_table = 'rating_history'
  AND ledger.source_table = archive.source_table
  AND ledger.source_key = archive.source_key
  AND ledger.outcome = 'rejected'
  AND archive.raw_row->'tier' = 'null'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM players.legacy_import_rejections rejection
    WHERE rejection.source_table = ledger.source_table AND rejection.source_key = ledger.source_key
  );

CREATE TRIGGER players_legacy_import_ledger_immutable
BEFORE UPDATE OR DELETE ON players.legacy_import_ledger
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_import_ledger_prevent_truncate
BEFORE TRUNCATE ON players.legacy_import_ledger
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();

CREATE TRIGGER players_legacy_discovery_aliases_immutable
BEFORE UPDATE OR DELETE ON players.legacy_discovery_aliases
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_discovery_aliases_prevent_truncate
BEFORE TRUNCATE ON players.legacy_discovery_aliases
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();

CREATE TRIGGER players_legacy_import_rejections_immutable
BEFORE UPDATE OR DELETE ON players.legacy_import_rejections
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_import_rejections_prevent_truncate
BEFORE TRUNCATE ON players.legacy_import_rejections
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();`

export const addCompactReferenceImport = {
  identity: 'players/0013',
  predecessor: 'players/0012',
  checksum: 'f60141b2bffe0e1e205d529e95cc74408a7380f66d1be30db70099947f3148f9',
  sql,
} as const

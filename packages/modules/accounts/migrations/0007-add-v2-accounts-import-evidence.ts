const sql = `SET LOCAL lock_timeout = '5s';

CREATE TABLE accounts.legacy_archive (
  source_table text NOT NULL CHECK (source_table IN ('user', 'oauth_account', 'session', 'player_link')),
  source_key text NOT NULL,
  account_id uuid,
  raw_row jsonb NOT NULL,
  secret_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_row_checksum char(64) NOT NULL CHECK (source_row_checksum ~ '^[0-9a-f]{64}$'),
  content_checksum char(64) NOT NULL CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key)
);

CREATE TABLE accounts.legacy_import_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  status text NOT NULL CHECK (status IN ('in-progress', 'complete', 'blocked')),
  stage text NOT NULL CHECK (stage IN ('users', 'oauth-identities', 'sessions', 'player-links', 'finalize')),
  last_source_key text,
  source_manifest jsonb NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  session_cutoff_at timestamptz NOT NULL,
  block_reason jsonb,
  reconciliation jsonb,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'blocked') = (block_reason IS NOT NULL)),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL)),
  CHECK ((status IN ('complete', 'blocked')) = (reconciliation IS NOT NULL))
);

CREATE TABLE accounts.legacy_import_ledger (
  source_table text NOT NULL,
  source_key text NOT NULL,
  archive_content_checksum char(64) NOT NULL CHECK (archive_content_checksum ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('transformed', 'rejected')),
  destination_kind text,
  destination_key text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key),
  FOREIGN KEY (source_table, source_key)
    REFERENCES accounts.legacy_archive(source_table, source_key)
);

CREATE TABLE accounts.legacy_import_rejections (
  source_table text NOT NULL,
  source_key text NOT NULL,
  code text NOT NULL,
  evidence jsonb NOT NULL,
  archive_content_checksum char(64) NOT NULL CHECK (archive_content_checksum ~ '^[0-9a-f]{64}$'),
  rejected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key, code),
  FOREIGN KEY (source_table, source_key)
    REFERENCES accounts.legacy_archive(source_table, source_key)
);

CREATE TABLE accounts.legacy_import_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('started', 'completed', 'blocked')),
  evidence jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION accounts.reject_legacy_import_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Accounts legacy migration evidence is immutable';
END;
$$;

CREATE TRIGGER accounts_legacy_archive_immutable
BEFORE UPDATE OR DELETE ON accounts.legacy_archive
FOR EACH ROW EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_legacy_archive_prevent_truncate
BEFORE TRUNCATE ON accounts.legacy_archive
FOR EACH STATEMENT EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_legacy_import_ledger_immutable
BEFORE UPDATE OR DELETE ON accounts.legacy_import_ledger
FOR EACH ROW EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_legacy_import_ledger_prevent_truncate
BEFORE TRUNCATE ON accounts.legacy_import_ledger
FOR EACH STATEMENT EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_legacy_import_rejections_immutable
BEFORE UPDATE OR DELETE ON accounts.legacy_import_rejections
FOR EACH ROW EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_legacy_import_rejections_prevent_truncate
BEFORE TRUNCATE ON accounts.legacy_import_rejections
FOR EACH STATEMENT EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_legacy_import_audit_immutable
BEFORE UPDATE OR DELETE ON accounts.legacy_import_audit_events
FOR EACH ROW EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_legacy_import_audit_prevent_truncate
BEFORE TRUNCATE ON accounts.legacy_import_audit_events
FOR EACH STATEMENT EXECUTE FUNCTION accounts.reject_legacy_import_evidence_change();
CREATE TRIGGER accounts_primary_attempts_prevent_truncate
BEFORE TRUNCATE ON accounts.primary_player_verification_attempts
FOR EACH STATEMENT EXECUTE FUNCTION accounts.reject_primary_player_history_mutation();
CREATE TRIGGER accounts_primary_outcomes_prevent_truncate
BEFORE TRUNCATE ON accounts.primary_player_verification_outcomes
FOR EACH STATEMENT EXECUTE FUNCTION accounts.reject_primary_player_history_mutation();`

export const addV2AccountsImportEvidence = {
  identity: 'accounts/0007',
  predecessor: 'accounts/0006',
  checksum: 'd396e8a1587e3eb8702d443efc92348a7889b2d2ef4770d40cf64d0ba4188208',
  sql,
} as const

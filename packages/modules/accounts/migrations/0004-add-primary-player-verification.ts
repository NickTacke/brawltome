const sql = `CREATE TABLE accounts.primary_player_verification_attempts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  proof_provider varchar(32) NOT NULL CHECK (proof_provider = 'steam'),
  proof_subject varchar(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  started_at timestamptz NOT NULL,
  UNIQUE (idempotency_key)
);

CREATE INDEX accounts_primary_player_attempts_account_started_idx
  ON accounts.primary_player_verification_attempts(account_id, started_at DESC, id DESC);

CREATE TABLE accounts.primary_player_verification_outcomes (
  attempt_id uuid PRIMARY KEY REFERENCES accounts.primary_player_verification_attempts(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL CHECK (status IN ('failed', 'conflict', 'verified')),
  brawlhalla_id bigint,
  player_name varchar(64),
  evidence_source varchar(64),
  evidence_checked_at timestamptz,
  completed_at timestamptz NOT NULL,
  CHECK (
    (status = 'failed' AND brawlhalla_id IS NULL AND player_name IS NULL AND evidence_source IS NULL AND evidence_checked_at IS NULL)
    OR
    (status = 'conflict' AND (
      (brawlhalla_id IS NULL AND player_name IS NULL AND evidence_source IS NULL AND evidence_checked_at IS NULL)
      OR
      (brawlhalla_id IS NOT NULL AND evidence_source IS NOT NULL AND evidence_checked_at IS NOT NULL)
    ))
    OR
    (status = 'verified' AND brawlhalla_id IS NOT NULL AND evidence_source IS NOT NULL AND evidence_checked_at IS NOT NULL)
  )
);

CREATE TABLE accounts.primary_players (
  account_id uuid PRIMARY KEY REFERENCES accounts.users(id) ON DELETE RESTRICT,
  brawlhalla_id bigint NOT NULL UNIQUE,
  player_name varchar(64),
  verified_at timestamptz NOT NULL,
  verification_attempt_id uuid NOT NULL UNIQUE REFERENCES accounts.primary_player_verification_attempts(id) ON DELETE RESTRICT
);

DO $$
BEGIN
  IF to_regclass('public.player_link') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'player_link' AND column_name = 'status'
     ) THEN
    INSERT INTO accounts.primary_player_verification_attempts (
      id,
      account_id,
      proof_provider,
      proof_subject,
      idempotency_key,
      started_at
    )
    SELECT
      gen_random_uuid(),
      link.user_id,
      'steam',
      link.steam_id,
      'legacy:' || link.user_id::text,
      link.linked_at AT TIME ZONE 'UTC'
    FROM public.player_link link
    JOIN accounts.users users ON users.id = link.user_id
    ON CONFLICT (idempotency_key) DO NOTHING;

    INSERT INTO accounts.primary_player_verification_outcomes (
      attempt_id,
      status,
      brawlhalla_id,
      player_name,
      evidence_source,
      evidence_checked_at,
      completed_at
    )
    SELECT
      attempt.id,
      CASE
        WHEN link.status = 'linked'
          AND link.brawlhalla_id IS NOT NULL
          AND (
            SELECT count(*)
            FROM public.player_link competing
            WHERE competing.status = 'linked' AND competing.brawlhalla_id = link.brawlhalla_id
          ) = 1
          THEN 'verified'
        WHEN link.status = 'conflict' OR (link.status = 'linked' AND link.brawlhalla_id IS NOT NULL)
          THEN 'conflict'
        ELSE 'failed'
      END,
      CASE WHEN link.status IN ('linked', 'conflict') THEN link.brawlhalla_id ELSE NULL END,
      NULL,
      CASE WHEN link.status IN ('linked', 'conflict') AND link.brawlhalla_id IS NOT NULL THEN 'legacy-steam-link' ELSE NULL END,
      CASE WHEN link.status IN ('linked', 'conflict') AND link.brawlhalla_id IS NOT NULL THEN link.linked_at AT TIME ZONE 'UTC' ELSE NULL END,
      link.linked_at AT TIME ZONE 'UTC'
    FROM public.player_link link
    JOIN accounts.primary_player_verification_attempts attempt
      ON attempt.account_id = link.user_id
     AND attempt.idempotency_key = 'legacy:' || link.user_id::text
    WHERE link.status <> 'pending'
    ON CONFLICT (attempt_id) DO NOTHING;

    INSERT INTO accounts.primary_players (
      account_id,
      brawlhalla_id,
      player_name,
      verified_at,
      verification_attempt_id
    )
    SELECT
      link.user_id,
      link.brawlhalla_id,
      NULL,
      link.linked_at AT TIME ZONE 'UTC',
      attempt.id
    FROM public.player_link link
    JOIN accounts.primary_player_verification_attempts attempt
      ON attempt.account_id = link.user_id
     AND attempt.idempotency_key = 'legacy:' || link.user_id::text
    WHERE link.status = 'linked'
      AND link.brawlhalla_id IS NOT NULL
      AND (
        SELECT count(*)
        FROM public.player_link competing
        WHERE competing.status = 'linked' AND competing.brawlhalla_id = link.brawlhalla_id
      ) = 1
    ON CONFLICT DO NOTHING;
  END IF;
END
$$;

CREATE FUNCTION accounts.reject_primary_player_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Primary Player verification history is immutable';
END
$$;

CREATE TRIGGER primary_player_attempts_immutable
BEFORE UPDATE OR DELETE ON accounts.primary_player_verification_attempts
FOR EACH ROW EXECUTE FUNCTION accounts.reject_primary_player_history_mutation();

CREATE TRIGGER primary_player_outcomes_immutable
BEFORE UPDATE OR DELETE ON accounts.primary_player_verification_outcomes
FOR EACH ROW EXECUTE FUNCTION accounts.reject_primary_player_history_mutation();

CREATE FUNCTION accounts.require_verified_primary_player_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM accounts.primary_player_verification_attempts attempt
    JOIN accounts.primary_player_verification_outcomes outcome ON outcome.attempt_id = attempt.id
    WHERE attempt.id = NEW.verification_attempt_id
      AND attempt.account_id = NEW.account_id
      AND outcome.status = 'verified'
      AND outcome.brawlhalla_id = NEW.brawlhalla_id
  ) THEN
    RAISE EXCEPTION 'Primary Player ownership requires the account''s verified attempt';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER primary_player_requires_verified_attempt
AFTER INSERT OR UPDATE ON accounts.primary_players
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION accounts.require_verified_primary_player_attempt();
`

export const addPrimaryPlayerVerification = {
  identity: 'accounts/0004',
  predecessor: 'accounts/0003',
  checksum: 'fb0dd41d2bb7175980963b13c4e809617cdd267dfe72170df594665ced443f33',
  sql,
} as const

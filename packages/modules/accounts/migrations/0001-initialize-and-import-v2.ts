const sql = `CREATE SCHEMA IF NOT EXISTS accounts;

CREATE TABLE accounts.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts.oauth_identities (
  provider varchar(32) NOT NULL,
  provider_account_id varchar(64) NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  display_name varchar(64) NOT NULL,
  avatar_hash varchar(128),
  refresh_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_account_id),
  UNIQUE (account_id, provider)
);

CREATE TABLE accounts.sessions (
  id varchar(64) PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  imported_from_v2 boolean NOT NULL DEFAULT false
);

CREATE INDEX accounts_sessions_account_id_idx ON accounts.sessions(account_id);
CREATE INDEX accounts_sessions_expires_at_idx ON accounts.sessions(expires_at);

DO $$
BEGIN
  IF to_regclass('public."user"') IS NOT NULL THEN
    INSERT INTO accounts.users (id, created_at, updated_at)
    SELECT id, created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
    FROM public."user"
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF to_regclass('public.oauth_account') IS NOT NULL THEN
    INSERT INTO accounts.oauth_identities (
      provider,
      provider_account_id,
      account_id,
      display_name,
      avatar_hash,
      refresh_token,
      created_at,
      updated_at
    )
    SELECT
      provider,
      provider_account_id,
      user_id,
      username,
      avatar_hash,
      refresh_token,
      created_at AT TIME ZONE 'UTC',
      updated_at AT TIME ZONE 'UTC'
    FROM public.oauth_account
    ON CONFLICT (provider, provider_account_id) DO NOTHING;
  END IF;

  IF to_regclass('public.session') IS NOT NULL THEN
    INSERT INTO accounts.sessions (id, account_id, expires_at, created_at, imported_from_v2)
    SELECT
      id,
      user_id,
      expires_at AT TIME ZONE 'UTC',
      created_at AT TIME ZONE 'UTC',
      true
    FROM public.session
    WHERE expires_at AT TIME ZONE 'UTC' > CURRENT_TIMESTAMP
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
`

export const initializeAndImportV2Accounts = {
  identity: 'accounts/0001',
  predecessor: null,
  checksum: '35221acf208c770f80f551d62a6c7698e4a3c03fb4aa5c87b83ab9c442232354',
  sql,
} as const

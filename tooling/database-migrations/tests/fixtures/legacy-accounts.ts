export const legacyAccountIds = {
  linked: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
  pending: 'd6bf157b-9c07-4ce3-9924-a053a28a59bb',
  failed: '7802b6d1-c270-4672-8764-9ba242f94955',
  conflict: 'b93eea0c-d546-4e85-b47b-6b91db98709d',
  duplicateA: 'ba1fbb0e-04fa-49f8-9f2a-e85c7d88298f',
  duplicateB: 'e72d7508-25e8-41b5-aee4-a67033fc9d8a',
  pendingWithPlayerId: '675f9f97-7212-4ae2-ac90-4e0ef009be4d',
  failedWithPlayerId: '7b656bcc-a69d-4aa6-b5f2-5286a843ad77',
  conflictWithPlayerId: 'f1fefefe-2269-4a66-a51f-09901158f666',
} as const

export const legacyAccountSecrets = {
  validRawSessionToken: 'fixture-valid-v2-session-token',
  expiredRawSessionToken: 'fixture-expired-v2-session-token',
  opaqueRefreshToken: 'enc:v2:fixture-ciphertext-not-a-real-credential',
  linkedSteamId: 'fixture-steam-linked',
} as const

export const legacyAccountsSchemaSql = `
CREATE TABLE public."user" (
  id uuid PRIMARY KEY,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);
CREATE TABLE public.oauth_account (
  provider varchar(32) NOT NULL,
  provider_account_id varchar(64) NOT NULL,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  username varchar(64) NOT NULL,
  avatar_hash varchar(128),
  refresh_token text,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  PRIMARY KEY (provider, provider_account_id),
  UNIQUE (user_id, provider)
);
CREATE TABLE public.session (
  id varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL
);
CREATE TABLE public.player_link (
  user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  brawlhalla_id integer,
  steam_id varchar(64) NOT NULL UNIQUE,
  linked_via varchar(32) NOT NULL,
  status varchar(16) NOT NULL,
  linked_at timestamp NOT NULL
);
`

const validSessionId = 'fea0e1b8a18d17a26e987879b75d5019d7c899f1637673bdcd7572941a231419'
const expiredSessionId = 'd140b987e2fb50281e9313c35528e38a9fc86abe99b35d800e6fe99344020434'

export const legacyAccountsRowsSql = `
INSERT INTO public."user" (id, created_at, updated_at) VALUES
  ('${legacyAccountIds.linked}', '2026-08-01 01:02:03.123', '2026-08-01 02:03:04.234'),
  ('${legacyAccountIds.pending}', '2026-08-02 01:02:03', '2026-08-02 02:03:04'),
  ('${legacyAccountIds.failed}', '2026-08-03 01:02:03', '2026-08-03 02:03:04'),
  ('${legacyAccountIds.conflict}', '2026-08-04 01:02:03', '2026-08-04 02:03:04'),
  ('${legacyAccountIds.duplicateA}', '2026-08-05 01:02:03', '2026-08-05 02:03:04'),
  ('${legacyAccountIds.duplicateB}', '2026-08-06 01:02:03', '2026-08-06 02:03:04'),
  ('${legacyAccountIds.pendingWithPlayerId}', '2026-08-07 01:02:03', '2026-08-07 02:03:04'),
  ('${legacyAccountIds.failedWithPlayerId}', '2026-08-08 01:02:03', '2026-08-08 02:03:04'),
  ('${legacyAccountIds.conflictWithPlayerId}', '2026-08-09 01:02:03', '2026-08-09 02:03:04');

INSERT INTO public.oauth_account
  (provider, provider_account_id, user_id, username, avatar_hash, refresh_token, created_at, updated_at)
SELECT 'discord', 'discord-' || id::text, id, 'User ' || row_number() OVER (ORDER BY id), NULL, NULL,
       created_at, updated_at
FROM public."user";
INSERT INTO public.oauth_account VALUES
  ('future-provider', 'future-linked', '${legacyAccountIds.linked}', 'Linked elsewhere', 'opaque-avatar',
   '${legacyAccountSecrets.opaqueRefreshToken}', '2026-08-01 03:04:05.345', '2026-08-01 04:05:06.456');

INSERT INTO public.session VALUES
  ('${validSessionId}', '${legacyAccountIds.linked}', '2099-08-10 10:00:00.789', '2026-08-01 05:06:07.567'),
  ('${expiredSessionId}', '${legacyAccountIds.linked}', '2020-08-10 10:00:00', '2020-08-01 05:06:07');

INSERT INTO public.player_link VALUES
  ('${legacyAccountIds.linked}', 42, '${legacyAccountSecrets.linkedSteamId}', 'steam', 'linked', '2026-08-05 10:00:00'),
  ('${legacyAccountIds.pending}', NULL, 'fixture-steam-pending', 'steam', 'pending', '2026-08-06 10:00:00'),
  ('${legacyAccountIds.failed}', NULL, 'fixture-steam-failed', 'steam', 'failed', '2026-08-07 10:00:00'),
  ('${legacyAccountIds.conflict}', NULL, 'fixture-steam-conflict', 'steam', 'conflict', '2026-08-08 10:00:00'),
  ('${legacyAccountIds.duplicateA}', 99, 'fixture-steam-duplicate-a', 'steam', 'linked', '2026-08-09 10:00:00'),
  ('${legacyAccountIds.duplicateB}', 99, 'fixture-steam-duplicate-b', 'steam', 'linked', '2026-08-10 10:00:00'),
  ('${legacyAccountIds.pendingWithPlayerId}', 31337, 'fixture-steam-pending-with-id', 'steam', 'pending', '2026-08-11 10:00:00'),
  ('${legacyAccountIds.failedWithPlayerId}', 31338, 'fixture-steam-failed-with-id', 'steam', 'failed', '2026-08-12 10:00:00'),
  ('${legacyAccountIds.conflictWithPlayerId}', 31339, 'fixture-steam-conflict-with-id', 'steam', 'conflict', '2026-08-13 10:00:00');
`

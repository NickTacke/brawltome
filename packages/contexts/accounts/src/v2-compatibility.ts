import type { TransactionSql } from 'postgres'

interface AccountIdentity {
  id: string
  createdAt: Date
  updatedAt: Date
}

export async function ensureV2UserIdentity(transaction: TransactionSql, account: AccountIdentity): Promise<void> {
  const [legacy] = await transaction.unsafe<{ available: boolean }[]>(
    `SELECT to_regclass('public."user"') IS NOT NULL AS available`,
  )
  if (!legacy.available) return

  await transaction.unsafe(
    `INSERT INTO public."user" (id, created_at, updated_at)
     VALUES ($1, $2::timestamptz AT TIME ZONE 'UTC', $3::timestamptz AT TIME ZONE 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [account.id, account.createdAt, account.updatedAt],
  )
}

export async function importValidV2Session(transaction: TransactionSql, sessionId: string): Promise<boolean> {
  const [tables] = await transaction.unsafe<{ available: boolean }[]>(
    `SELECT to_regclass('public."user"') IS NOT NULL
        AND to_regclass('public.oauth_account') IS NOT NULL
        AND to_regclass('public.session') IS NOT NULL AS available`,
  )
  if (!tables.available) return false

  await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`v2-session:${sessionId}`])

  const [legacySession] = await transaction.unsafe<{ user_id: string }[]>(
    `SELECT user_id
     FROM public.session
     WHERE id = $1
       AND expires_at AT TIME ZONE 'UTC' > CURRENT_TIMESTAMP`,
    [sessionId],
  )
  if (!legacySession) return false

  const [identityConflict] = await transaction.unsafe<{ conflicted: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.oauth_account legacy
       JOIN accounts.oauth_identities current
         ON current.provider = legacy.provider
        AND current.provider_account_id = legacy.provider_account_id
       WHERE legacy.user_id = $1
         AND current.account_id <> legacy.user_id
     ) AS conflicted`,
    [legacySession.user_id],
  )
  if (identityConflict.conflicted) return false

  await transaction.unsafe(
    `INSERT INTO accounts.users (id, created_at, updated_at)
     SELECT id, created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
     FROM public."user"
     WHERE id = $1
     ON CONFLICT (id) DO UPDATE SET
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at`,
    [legacySession.user_id],
  )

  await transaction.unsafe(
    `INSERT INTO accounts.oauth_identities (
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
     WHERE user_id = $1
     ON CONFLICT (provider, provider_account_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_hash = EXCLUDED.avatar_hash,
       refresh_token = EXCLUDED.refresh_token,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at
     WHERE accounts.oauth_identities.account_id = EXCLUDED.account_id`,
    [legacySession.user_id],
  )

  await transaction.unsafe(
    `INSERT INTO accounts.sessions (id, account_id, expires_at, created_at, imported_from_v2)
     SELECT id, user_id, expires_at AT TIME ZONE 'UTC', created_at AT TIME ZONE 'UTC', true
     FROM public.session
     WHERE id = $1
       AND expires_at AT TIME ZONE 'UTC' > CURRENT_TIMESTAMP
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       expires_at = EXCLUDED.expires_at,
       created_at = EXCLUDED.created_at,
       imported_from_v2 = true`,
    [sessionId],
  )

  return true
}

export async function validV2SessionExists(transaction: TransactionSql, sessionId: string): Promise<boolean> {
  const [table] = await transaction.unsafe<{ available: boolean }[]>(
    `SELECT to_regclass('public.session') IS NOT NULL AS available`,
  )
  if (!table.available) return false

  const [session] = await transaction.unsafe<{ valid: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.session
       WHERE id = $1
         AND expires_at AT TIME ZONE 'UTC' > CURRENT_TIMESTAMP
     ) AS valid`,
    [sessionId],
  )
  return session.valid
}

export async function extendV2Session(transaction: TransactionSql, sessionId: string, expiresAt: Date): Promise<void> {
  const [table] = await transaction.unsafe<{ available: boolean }[]>(
    `SELECT to_regclass('public.session') IS NOT NULL AS available`,
  )
  if (!table.available) return

  await transaction.unsafe(
    `UPDATE public.session
     SET expires_at = $2::timestamptz AT TIME ZONE 'UTC'
     WHERE id = $1`,
    [sessionId, expiresAt],
  )
}

export async function revokeV2Session(transaction: TransactionSql, sessionId: string): Promise<void> {
  const [table] = await transaction.unsafe<{ available: boolean }[]>(
    `SELECT to_regclass('public.session') IS NOT NULL AS available`,
  )
  if (!table.available) return

  await transaction.unsafe('DELETE FROM public.session WHERE id = $1', [sessionId])
}

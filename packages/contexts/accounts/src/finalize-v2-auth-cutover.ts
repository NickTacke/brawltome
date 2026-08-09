import type { Sql, TransactionSql } from 'postgres'

export interface V2AuthCutoverFinalization {
  finalizedSessions: number
}

export async function finalizeV2AuthCutover(client: Sql): Promise<V2AuthCutoverFinalization> {
  return client.begin(async (transaction) => {
    await transaction.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('accounts:v2-auth-cutover', 0))")

    const [existing] = await transaction.unsafe<{ finalized: boolean }[]>(
      'SELECT EXISTS (SELECT 1 FROM accounts.v2_auth_cutover WHERE singleton) AS finalized',
    )
    if (existing.finalized) return { finalizedSessions: 0 }

    const [legacy] = await transaction.unsafe<{ available: boolean }[]>(
      `SELECT to_regclass('public."user"') IS NOT NULL
          AND to_regclass('public.oauth_account') IS NOT NULL
          AND to_regclass('public.session') IS NOT NULL AS available`,
    )
    if (!legacy.available) {
      throw new Error('V2 auth tables must remain available until cutover finalization completes')
    }

    await transaction.unsafe(
      `LOCK TABLE
         accounts.users,
         accounts.oauth_identities,
         accounts.sessions,
         public."user",
         public.oauth_account,
         public.session
       IN SHARE ROW EXCLUSIVE MODE`,
    )

    const [conflict] = await transaction.unsafe<
      {
        provider: string
        provider_account_id: string
        current_account_id: string
        legacy_account_id: string
      }[]
    >(
      `SELECT
         legacy.provider,
         legacy.provider_account_id,
         current.account_id AS current_account_id,
         legacy.user_id AS legacy_account_id
       FROM public.oauth_account legacy
       JOIN accounts.oauth_identities current
         ON current.provider = legacy.provider
        AND current.provider_account_id = legacy.provider_account_id
       WHERE current.account_id <> legacy.user_id
       LIMIT 1`,
    )
    if (conflict) {
      throw new Error(
        `V2 OAuth identity ${conflict.provider}/${conflict.provider_account_id} belongs to conflicting Accounts users`,
      )
    }

    await transaction.unsafe(
      `INSERT INTO accounts.users (id, created_at, updated_at)
       SELECT id, created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
       FROM public."user"
       ON CONFLICT (id) DO UPDATE SET
         updated_at = EXCLUDED.updated_at
       WHERE EXCLUDED.updated_at > accounts.users.updated_at`,
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
       ON CONFLICT (provider, provider_account_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         avatar_hash = EXCLUDED.avatar_hash,
         refresh_token = EXCLUDED.refresh_token,
         updated_at = EXCLUDED.updated_at
       WHERE accounts.oauth_identities.account_id = EXCLUDED.account_id
         AND EXCLUDED.updated_at > accounts.oauth_identities.updated_at`,
    )

    await transaction.unsafe(
      `DELETE FROM accounts.sessions current
       WHERE current.imported_from_v2
         AND NOT EXISTS (
           SELECT 1
           FROM public.session legacy
           WHERE legacy.id = current.id
             AND legacy.expires_at AT TIME ZONE 'UTC' > CURRENT_TIMESTAMP
         )`,
    )

    await transaction.unsafe(
      `INSERT INTO accounts.sessions (id, account_id, expires_at, created_at, imported_from_v2)
       SELECT
         id,
         user_id,
         expires_at AT TIME ZONE 'UTC',
         created_at AT TIME ZONE 'UTC',
         true
       FROM public.session
       WHERE expires_at AT TIME ZONE 'UTC' > CURRENT_TIMESTAMP
       ON CONFLICT (id) DO UPDATE SET
         account_id = EXCLUDED.account_id,
         expires_at = EXCLUDED.expires_at,
         created_at = EXCLUDED.created_at,
         imported_from_v2 = true
       WHERE accounts.sessions.imported_from_v2`,
    )

    const finalized = await transaction.unsafe<{ id: string }[]>(
      `UPDATE accounts.sessions
       SET imported_from_v2 = false
       WHERE imported_from_v2
       RETURNING id`,
    )

    await transaction.unsafe(
      `INSERT INTO accounts.v2_auth_cutover (singleton, finalized_at)
       VALUES (true, now())`,
    )

    return { finalizedSessions: finalized.length }
  })
}

export async function v2AuthCutoverIsFinalized(transaction: TransactionSql): Promise<boolean> {
  const [state] = await transaction.unsafe<{ finalized: boolean }[]>(
    'SELECT EXISTS (SELECT 1 FROM accounts.v2_auth_cutover WHERE singleton) AS finalized',
  )
  return state.finalized
}

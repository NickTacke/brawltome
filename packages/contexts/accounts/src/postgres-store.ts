import postgres, { type Sql } from 'postgres'
import type { Account, AccountsStore } from './accounts'
import {
  ensureV2UserIdentity,
  extendV2Session,
  importValidV2Session,
  revokeV2Session,
  validV2SessionExists,
} from './v2-compatibility'

interface AccountRow {
  id: string
  provider: string
  display_name: string
  avatar_hash: string | null
  provider_account_id: string
  created_at: Date
}

interface SessionAccountRow extends AccountRow {
  expires_at: Date
  imported_from_v2: boolean
}

const sessionAccountQuery = `SELECT
  users.id,
  identities.provider,
  identities.display_name,
  identities.avatar_hash,
  identities.provider_account_id,
  users.created_at,
  sessions.expires_at,
  sessions.imported_from_v2
FROM accounts.sessions sessions
JOIN accounts.users users ON users.id = sessions.account_id
JOIN LATERAL (
  SELECT provider, display_name, avatar_hash, provider_account_id
  FROM accounts.oauth_identities
  WHERE account_id = users.id
  ORDER BY (provider = 'discord') DESC, provider, provider_account_id
  LIMIT 1
) identities ON true
WHERE sessions.id = $1`

export function createPostgresAccountsStore(connectionString: string): {
  store: AccountsStore
  close: () => Promise<void>
} {
  const client = postgres(connectionString)
  return {
    store: postgresAccountsStore(client),
    close: () => client.end(),
  }
}

function postgresAccountsStore(client: Sql): AccountsStore {
  return {
    async upsertDiscordIdentity(profile) {
      return client.begin(async (transaction) => {
        const lockKey = `discord:${profile.providerAccountId}`
        await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey])

        const existing = await transaction.unsafe<AccountRow[]>(
          `SELECT
             users.id,
             identities.provider,
             identities.display_name,
             identities.avatar_hash,
             identities.provider_account_id,
             users.created_at
           FROM accounts.oauth_identities identities
           JOIN accounts.users users ON users.id = identities.account_id
           WHERE identities.provider = 'discord'
             AND identities.provider_account_id = $1`,
          [profile.providerAccountId],
        )

        if (existing[0]) {
          const updated = await transaction.unsafe<AccountRow[]>(
            `UPDATE accounts.oauth_identities identities
             SET display_name = $1,
                 avatar_hash = $2,
                 updated_at = now()
             FROM accounts.users users
             WHERE identities.provider = 'discord'
               AND identities.provider_account_id = $3
               AND users.id = identities.account_id
             RETURNING
               users.id,
               identities.provider,
               identities.display_name,
               identities.avatar_hash,
               identities.provider_account_id,
               users.created_at`,
            [profile.displayName, profile.avatarHash, profile.providerAccountId],
          )
          return mapAccount(updated[0])
        }

        const [createdUser] = await transaction.unsafe<{ id: string; created_at: Date; updated_at: Date }[]>(
          'INSERT INTO accounts.users DEFAULT VALUES RETURNING id, created_at, updated_at',
        )
        await ensureV2UserIdentity(transaction, {
          id: createdUser.id,
          createdAt: createdUser.created_at,
          updatedAt: createdUser.updated_at,
        })
        const [createdIdentity] = await transaction.unsafe<AccountRow[]>(
          `INSERT INTO accounts.oauth_identities (
             provider,
             provider_account_id,
             account_id,
             display_name,
             avatar_hash
           ) VALUES ('discord', $1, $2, $3, $4)
           RETURNING
             $2::uuid AS id,
             provider,
             display_name,
             avatar_hash,
             provider_account_id,
             $5::timestamptz AS created_at`,
          [profile.providerAccountId, createdUser.id, profile.displayName, profile.avatarHash, createdUser.created_at],
        )
        return mapAccount(createdIdentity)
      })
    },

    async createSession(session) {
      await client`
        INSERT INTO accounts.sessions (id, account_id, expires_at)
        VALUES (${session.id}, ${session.accountId}, ${session.expiresAt})
      `
    },

    async findSessionAccount(id) {
      return client.begin(async (transaction) => {
        const rows = await transaction.unsafe<SessionAccountRow[]>(sessionAccountQuery, [id])
        const current = rows[0]
        if (current) {
          if (current.imported_from_v2 && !(await validV2SessionExists(transaction, id))) {
            await transaction.unsafe('DELETE FROM accounts.sessions WHERE id = $1', [id])
            return null
          }
          return mapSessionAccount(current)
        }

        if (!(await importValidV2Session(transaction, id))) return null

        const importedRows = await transaction.unsafe<SessionAccountRow[]>(sessionAccountQuery, [id])
        return importedRows[0] ? mapSessionAccount(importedRows[0]) : null
      })
    },

    async extendSession(id, expiresAt) {
      await client.begin(async (transaction) => {
        const [session] = await transaction.unsafe<{ imported_from_v2: boolean }[]>(
          `UPDATE accounts.sessions
           SET expires_at = $2
           WHERE id = $1
           RETURNING imported_from_v2`,
          [id, expiresAt],
        )
        if (session?.imported_from_v2) await extendV2Session(transaction, id, expiresAt)
      })
    },

    async deleteSession(id) {
      await client.begin(async (transaction) => {
        await transaction.unsafe('DELETE FROM accounts.sessions WHERE id = $1', [id])
        await revokeV2Session(transaction, id)
      })
    },
  }
}

function mapSessionAccount(row: SessionAccountRow): { account: Account; expiresAt: Date } {
  return { account: mapAccount(row), expiresAt: row.expires_at }
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl:
      row.provider === 'discord' && row.avatar_hash
        ? `https://cdn.discordapp.com/avatars/${row.provider_account_id}/${row.avatar_hash}.png`
        : null,
    createdAt: row.created_at,
  }
}

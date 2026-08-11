import postgres, { type Sql, type TransactionSql } from 'postgres'
import {
  type Account,
  type AccountPreferences,
  AccountsMaintenanceError,
  type AccountsStore,
  InvalidSavedPlayerError,
  LEADERBOARD_BRACKETS,
  LEADERBOARD_REGIONS,
  MAX_PINNED_PLAYERS,
  MAX_SAVED_PLAYERS,
  type PinnedPlayer,
  type PrimaryPlayerVerificationAttempt,
  type PrimaryPlayerVerificationState,
  type SavedPlayer,
} from './accounts'
import { v2AuthCutoverIsFinalized } from './finalize-v2-auth-cutover'
import {
  ACCOUNTS_MAINTENANCE_RETRY_AFTER_SECONDS,
  ACCOUNTS_WRITER_FENCE_WAIT,
  ACCOUNTS_WRITER_MAINTENANCE_FENCE,
} from './maintenance-fence'
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

interface PreferencesRow {
  schema_version: number
  leaderboard_bracket: string
  leaderboard_region: string
}

interface VerificationAttemptRow {
  id: string
  proof_subject: string
  status: 'pending' | 'failed' | 'conflict' | 'verified'
  started_at: Date
  completed_at: Date | null
  brawlhalla_id: number | null
  player_name: string | null
}

interface VerificationAttemptOwnerRow {
  account_id: string
}

interface PrimaryPlayerRow {
  account_id: string
  brawlhalla_id: number
  player_name: string | null
  verified_at: Date
  verification_attempt_id: string
}

interface SavedPlayerRow {
  brawlhalla_id: number
  position: number
  pin_position: number | null
  saved_at: Date
}

interface PinnedPlayerRow {
  brawlhalla_id: number
  position: number
  pinned_at: Date
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

const verificationAttemptQuery = `SELECT
  attempts.id,
  attempts.proof_subject,
  COALESCE(outcomes.status, 'pending') AS status,
  attempts.started_at,
  outcomes.completed_at,
  outcomes.brawlhalla_id::int,
  outcomes.player_name
FROM accounts.primary_player_verification_attempts attempts
LEFT JOIN accounts.primary_player_verification_outcomes outcomes ON outcomes.attempt_id = attempts.id`

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

async function acquireAccountsWriterFence(transaction: TransactionSql): Promise<void> {
  await transaction.unsafe("SELECT set_config('lock_timeout', $1, true)", [ACCOUNTS_WRITER_FENCE_WAIT])
  try {
    await transaction.unsafe('SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [
      ACCOUNTS_WRITER_MAINTENANCE_FENCE,
    ])
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') {
      throw new AccountsMaintenanceError(ACCOUNTS_MAINTENANCE_RETRY_AFTER_SECONDS)
    }
    throw error
  }
  await transaction.unsafe("SELECT set_config('lock_timeout', '0', true)")
}

async function withAccountsWriterFence<T>(client: Sql, run: (transaction: TransactionSql) => Promise<T>): Promise<T> {
  const result = await client.begin(async (transaction) => {
    await acquireAccountsWriterFence(transaction)
    return run(transaction)
  })
  return result as T
}

function postgresAccountsStore(client: Sql): AccountsStore {
  return {
    async upsertDiscordIdentity(profile) {
      return withAccountsWriterFence(client, async (transaction) => {
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
      await withAccountsWriterFence(client, async (transaction) => {
        await transaction.unsafe('INSERT INTO accounts.sessions (id, account_id, expires_at) VALUES ($1, $2, $3)', [
          session.id,
          session.accountId,
          session.expiresAt,
        ])
      })
    },

    async findSessionAccount(id) {
      return withAccountsWriterFence(client, async (transaction) => {
        const rows = await transaction.unsafe<SessionAccountRow[]>(sessionAccountQuery, [id])
        const current = rows[0]
        const cutoverFinalized = await v2AuthCutoverIsFinalized(transaction)
        if (current) {
          if (current.imported_from_v2 && !cutoverFinalized && !(await validV2SessionExists(transaction, id))) {
            await transaction.unsafe('DELETE FROM accounts.sessions WHERE id = $1', [id])
            return null
          }
          return mapSessionAccount(current)
        }

        if (cutoverFinalized || !(await importValidV2Session(transaction, id))) return null

        const importedRows = await transaction.unsafe<SessionAccountRow[]>(sessionAccountQuery, [id])
        return importedRows[0] ? mapSessionAccount(importedRows[0]) : null
      })
    },

    async extendSession(id, expiresAt) {
      await withAccountsWriterFence(client, async (transaction) => {
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
      await withAccountsWriterFence(client, async (transaction) => {
        await transaction.unsafe('DELETE FROM accounts.sessions WHERE id = $1', [id])
        await revokeV2Session(transaction, id)
      })
    },

    async findPreferences(accountId) {
      const [row] = await client.unsafe<PreferencesRow[]>(
        `SELECT schema_version, leaderboard_bracket, leaderboard_region
         FROM accounts.preferences
         WHERE account_id = $1`,
        [accountId],
      )
      return row ? mapPreferences(row) : null
    },

    async upsertPreferences(accountId, preferences) {
      return withAccountsWriterFence(client, async (transaction) => {
        const [row] = await transaction.unsafe<PreferencesRow[]>(
          `INSERT INTO accounts.preferences (
             account_id,
             schema_version,
             leaderboard_bracket,
             leaderboard_region
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (account_id) DO UPDATE
           SET schema_version = EXCLUDED.schema_version,
               leaderboard_bracket = EXCLUDED.leaderboard_bracket,
               leaderboard_region = EXCLUDED.leaderboard_region,
               updated_at = now()
           RETURNING schema_version, leaderboard_bracket, leaderboard_region`,
          [accountId, preferences.version, preferences.leaderboardBracket, preferences.leaderboardRegion],
        )
        const stored = mapPreferences(row)
        if (!stored) throw new Error('Accounts stored an unsupported preference version')
        return stored
      })
    },

    async beginPrimaryPlayerVerification(input) {
      return withAccountsWriterFence(client, async (transaction) => {
        await transaction.unsafe(
          `INSERT INTO accounts.primary_player_verification_attempts (
             id, account_id, proof_provider, proof_subject, idempotency_key, started_at
           ) VALUES ($1, $2, 'steam', $3, $4, $5)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [input.attemptId, input.accountId, input.steamId, input.idempotencyKey, input.startedAt],
        )
        const [attempt] = await transaction.unsafe<VerificationAttemptRow[]>(
          `${verificationAttemptQuery}
           WHERE attempts.account_id = $1 AND attempts.idempotency_key = $2`,
          [input.accountId, input.idempotencyKey],
        )
        if (!attempt) throw new Error('Failed to create Primary Player verification attempt')
        return mapVerificationAttempt(attempt)
      })
    },

    async findPrimaryPlayerVerificationAttempt(attemptId) {
      const attempt = await findVerificationAttempt(client, attemptId)
      return attempt ? { attempt: mapVerificationAttempt(attempt), steamId: attempt.proof_subject } : null
    },

    async completePrimaryPlayerVerification(input) {
      return withAccountsWriterFence(client, async (transaction) => {
        const [owner] = await transaction.unsafe<VerificationAttemptOwnerRow[]>(
          `SELECT account_id
           FROM accounts.primary_player_verification_attempts
           WHERE id = $1
           FOR UPDATE`,
          [input.attemptId],
        )
        if (!owner) throw new Error('Unknown Primary Player verification attempt')

        const existing = await findVerificationAttempt(transaction, input.attemptId)
        if (!existing) throw new Error('Unknown Primary Player verification attempt')
        if (existing.status !== 'pending') return mapVerificationAttempt(existing)

        if (!input.evidence) {
          await transaction.unsafe(
            `INSERT INTO accounts.primary_player_verification_outcomes (
               attempt_id, status, completed_at
             ) VALUES ($1, 'failed', $2)`,
            [input.attemptId, input.completedAt],
          )
          const completed = await findVerificationAttempt(transaction, input.attemptId)
          if (!completed) throw new Error('Failed to record Primary Player verification outcome')
          return mapVerificationAttempt(completed)
        }

        const lockKeys = [`account:${owner.account_id}`, `player:${input.evidence.brawlhallaId}`].sort()
        for (const lockKey of lockKeys) {
          await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey])
        }

        const ownership = await transaction.unsafe<PrimaryPlayerRow[]>(
          `SELECT account_id, brawlhalla_id::int, player_name, verified_at
           FROM accounts.primary_players
           WHERE account_id = $1 OR brawlhalla_id = $2
           FOR UPDATE`,
          [owner.account_id, input.evidence.brawlhallaId],
        )
        const accountOwnership = ownership.find(({ account_id }) => account_id === owner.account_id)
        const playerOwnership = ownership.find(({ brawlhalla_id }) => brawlhalla_id === input.evidence?.brawlhallaId)
        const conflict =
          (accountOwnership && accountOwnership.brawlhalla_id !== input.evidence.brawlhallaId) ||
          (playerOwnership && playerOwnership.account_id !== owner.account_id)

        if (!conflict && !accountOwnership) {
          await transaction.unsafe(
            `INSERT INTO accounts.primary_players (
               account_id, brawlhalla_id, player_name, verified_at, verification_attempt_id
             ) VALUES ($1, $2, $3, $4, $5)`,
            [owner.account_id, input.evidence.brawlhallaId, input.evidence.name, input.completedAt, input.attemptId],
          )
        }

        await transaction.unsafe(
          `INSERT INTO accounts.primary_player_verification_outcomes (
             attempt_id,
             status,
             brawlhalla_id,
             player_name,
             evidence_source,
             evidence_checked_at,
             completed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.attemptId,
            conflict ? 'conflict' : 'verified',
            input.evidence.brawlhallaId,
            input.evidence.name,
            input.evidence.source,
            input.evidence.checkedAt,
            input.completedAt,
          ],
        )
        const completed = await findVerificationAttempt(transaction, input.attemptId)
        if (!completed) throw new Error('Failed to record Primary Player verification outcome')
        return mapVerificationAttempt(completed)
      })
    },

    async getPrimaryPlayerVerificationState(accountId) {
      return client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
        const primaryRows = await transaction.unsafe<PrimaryPlayerRow[]>(
          `SELECT account_id, brawlhalla_id::int, player_name, verified_at
           FROM accounts.primary_players
           WHERE account_id = $1`,
          [accountId],
        )
        const attemptRows = await transaction.unsafe<VerificationAttemptRow[]>(
          `${verificationAttemptQuery}
           WHERE attempts.account_id = $1
           ORDER BY attempts.started_at DESC, attempts.id DESC`,
          [accountId],
        )
        return mapVerificationState(primaryRows[0], attemptRows)
      })
    },

    async readPrimaryMonitoringSnapshot() {
      return client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
        const [clock] = await transaction.unsafe<{ observed_at: Date }[]>('SELECT clock_timestamp() AS observed_at')
        const rows = await transaction.unsafe<PrimaryPlayerRow[]>(
          `SELECT account_id, brawlhalla_id::int, player_name, verified_at, verification_attempt_id
           FROM accounts.primary_players
           ORDER BY brawlhalla_id`,
        )
        return {
          observedAt: clock.observed_at,
          targets: rows.map(({ brawlhalla_id, verified_at, verification_attempt_id }) => ({
            assignmentId: verification_attempt_id,
            brawlhallaId: brawlhalla_id,
            verifiedAt: verified_at,
          })),
        }
      })
    },

    getSavedPlayers(accountId) {
      return readSavedPlayers(client, accountId)
    },

    async savePlayer(accountId, brawlhallaId) {
      return withAccountsWriterFence(client, async (transaction) => {
        await lockSavedPlayers(transaction, accountId)
        const savedPlayers = await readSavedPlayers(transaction, accountId)
        const existing = savedPlayers.find((player) => player.brawlhallaId === brawlhallaId)
        if (existing) return existing
        if (savedPlayers.length >= MAX_SAVED_PLAYERS) {
          throw new InvalidSavedPlayerError(`Saved Players cannot exceed ${MAX_SAVED_PLAYERS}`)
        }
        const [savedPlayer] = await transaction.unsafe<SavedPlayerRow[]>(
          `INSERT INTO accounts.saved_players (account_id, brawlhalla_id, position)
           VALUES ($1, $2, $3)
           RETURNING brawlhalla_id::int, position, NULL::integer AS pin_position, saved_at`,
          [accountId, brawlhallaId, savedPlayers.length],
        )
        if (!savedPlayer) throw new Error('Failed to save player')
        return mapSavedPlayer(savedPlayer)
      })
    },

    async removeSavedPlayer(accountId, brawlhallaId) {
      await withAccountsWriterFence(client, async (transaction) => {
        const locked = await lockSavedPlayerForUpdate(transaction, accountId, brawlhallaId)
        if (!locked) return
        await lockSavedPlayers(transaction, accountId)
        const [removed] = await transaction.unsafe<{ position: number }[]>(
          `DELETE FROM accounts.saved_players
           WHERE account_id = $1 AND brawlhalla_id = $2
           RETURNING position`,
          [accountId, brawlhallaId],
        )
        if (!removed) return
        await transaction.unsafe(
          `UPDATE accounts.saved_players
           SET position = position - 1
           WHERE account_id = $1 AND position > $2`,
          [accountId, removed.position],
        )
      })
    },

    async reorderSavedPlayers(accountId, orderedBrawlhallaIds) {
      return withAccountsWriterFence(client, async (transaction) => {
        await lockSavedPlayerCollectionForUpdate(transaction, accountId)
        await lockSavedPlayers(transaction, accountId)
        const current = await readSavedPlayers(transaction, accountId)
        const currentIds = current.map(({ brawlhallaId }) => brawlhallaId).sort((left, right) => left - right)
        const requestedIds = [...orderedBrawlhallaIds].sort((left, right) => left - right)
        if (
          currentIds.length !== requestedIds.length ||
          currentIds.some((brawlhallaId, index) => brawlhallaId !== requestedIds[index])
        ) {
          throw new InvalidSavedPlayerError('Saved Player order must contain the complete collection')
        }
        await transaction.unsafe(
          `UPDATE accounts.saved_players saved
           SET position = requested.position
           FROM (
             SELECT brawlhalla_id, ordinality::int - 1 AS position
             FROM unnest($2::bigint[]) WITH ORDINALITY AS ordered(brawlhalla_id, ordinality)
           ) requested
           WHERE saved.account_id = $1 AND saved.brawlhalla_id = requested.brawlhalla_id`,
          [accountId, orderedBrawlhallaIds],
        )
        return readSavedPlayers(transaction, accountId)
      })
    },

    async getPlayerShortcuts(accountId) {
      return client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
        const [primary] = await transaction.unsafe<PrimaryPlayerRow[]>(
          `SELECT account_id, brawlhalla_id::int, player_name, verified_at, verification_attempt_id
           FROM accounts.primary_players
           WHERE account_id = $1`,
          [accountId],
        )
        return {
          primaryPlayer: primary
            ? {
                brawlhallaId: primary.brawlhalla_id,
                name: primary.player_name,
                verifiedAt: primary.verified_at,
              }
            : null,
          pinnedPlayers: await readPinnedPlayers(transaction, accountId),
        }
      })
    },

    async pinSavedPlayer(accountId, brawlhallaId) {
      return withAccountsWriterFence(client, async (transaction) => {
        await lockSavedPlayerForPin(transaction, accountId, brawlhallaId)
        await lockSavedPlayers(transaction, accountId)
        const pinnedPlayers = await readPinnedPlayers(transaction, accountId)
        const existing = pinnedPlayers.find((player) => player.brawlhallaId === brawlhallaId)
        if (existing) return existing

        const [membership] = await transaction.unsafe<{ saved: boolean; primary_player: boolean }[]>(
          `SELECT
             EXISTS (
               SELECT 1 FROM accounts.saved_players
               WHERE account_id = $1 AND brawlhalla_id = $2
             ) AS saved,
             EXISTS (
               SELECT 1 FROM accounts.primary_players
               WHERE account_id = $1 AND brawlhalla_id = $2
             ) AS primary_player`,
          [accountId, brawlhallaId],
        )
        if (membership?.primary_player) {
          throw new InvalidSavedPlayerError('Primary Player cannot occupy a pin')
        }
        if (!membership?.saved) throw new InvalidSavedPlayerError('Pinned Player must be saved first')
        if (pinnedPlayers.length >= MAX_PINNED_PLAYERS) {
          throw new InvalidSavedPlayerError(`Pinned Players cannot exceed ${MAX_PINNED_PLAYERS}`)
        }

        const [pinnedPlayer] = await transaction.unsafe<PinnedPlayerRow[]>(
          `INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position)
           VALUES ($1, $2, $3)
           RETURNING brawlhalla_id::int, position, pinned_at`,
          [accountId, brawlhallaId, pinnedPlayers.length],
        )
        if (!pinnedPlayer) throw new Error('Failed to pin Saved Player')
        return mapPinnedPlayer(pinnedPlayer)
      })
    },

    async unpinSavedPlayer(accountId, brawlhallaId) {
      await withAccountsWriterFence(client, async (transaction) => {
        await lockSavedPlayers(transaction, accountId)
        const [removed] = await transaction.unsafe<{ position: number }[]>(
          `DELETE FROM accounts.saved_player_pins
           WHERE account_id = $1 AND brawlhalla_id = $2
           RETURNING position`,
          [accountId, brawlhallaId],
        )
        if (!removed) return
      })
    },

    async reorderPinnedPlayers(accountId, orderedBrawlhallaIds) {
      return withAccountsWriterFence(client, async (transaction) => {
        await lockSavedPlayers(transaction, accountId)
        const current = await readPinnedPlayers(transaction, accountId)
        const currentIds = current.map(({ brawlhallaId }) => brawlhallaId).sort((left, right) => left - right)
        const requestedIds = [...orderedBrawlhallaIds].sort((left, right) => left - right)
        if (
          currentIds.length !== requestedIds.length ||
          currentIds.some((brawlhallaId, index) => brawlhallaId !== requestedIds[index])
        ) {
          throw new InvalidSavedPlayerError('Pinned Player order must contain the complete pinned collection')
        }
        await transaction.unsafe(
          `UPDATE accounts.saved_player_pins pinned
           SET position = requested.position
           FROM (
             SELECT brawlhalla_id, ordinality::int - 1 AS position
             FROM unnest($2::bigint[]) WITH ORDINALITY AS ordered(brawlhalla_id, ordinality)
           ) requested
           WHERE pinned.account_id = $1 AND pinned.brawlhalla_id = requested.brawlhalla_id`,
          [accountId, orderedBrawlhallaIds],
        )
        return readPinnedPlayers(transaction, accountId)
      })
    },
  }
}

async function lockSavedPlayerForUpdate(
  transaction: TransactionSql,
  accountId: string,
  brawlhallaId: number,
): Promise<boolean> {
  const [savedPlayer] = await transaction.unsafe<{ brawlhalla_id: number }[]>(
    `SELECT brawlhalla_id::int
     FROM accounts.saved_players
     WHERE account_id = $1 AND brawlhalla_id = $2
     FOR UPDATE`,
    [accountId, brawlhallaId],
  )
  return Boolean(savedPlayer)
}

async function lockSavedPlayerCollectionForUpdate(transaction: TransactionSql, accountId: string): Promise<void> {
  await transaction.unsafe(
    `SELECT brawlhalla_id
     FROM accounts.saved_players
     WHERE account_id = $1
     ORDER BY brawlhalla_id
     FOR UPDATE`,
    [accountId],
  )
}

async function lockSavedPlayerForPin(
  transaction: TransactionSql,
  accountId: string,
  brawlhallaId: number,
): Promise<void> {
  await transaction.unsafe(
    `SELECT brawlhalla_id
     FROM accounts.saved_players
     WHERE account_id = $1 AND brawlhalla_id = $2
     FOR KEY SHARE`,
    [accountId, brawlhallaId],
  )
}

async function lockSavedPlayers(transaction: TransactionSql, accountId: string): Promise<void> {
  await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`account:${accountId}`])
}

async function readSavedPlayers(client: Sql | TransactionSql, accountId: string): Promise<SavedPlayer[]> {
  const rows = await client.unsafe<SavedPlayerRow[]>(
    `SELECT saved.brawlhalla_id::int, saved.position, pins.position AS pin_position, saved.saved_at
     FROM accounts.saved_players saved
     LEFT JOIN accounts.saved_player_pins pins
       ON pins.account_id = saved.account_id AND pins.brawlhalla_id = saved.brawlhalla_id
     WHERE saved.account_id = $1
     ORDER BY saved.position, saved.brawlhalla_id`,
    [accountId],
  )
  return rows.map(mapSavedPlayer)
}

async function readPinnedPlayers(client: Sql | TransactionSql, accountId: string): Promise<PinnedPlayer[]> {
  const rows = await client.unsafe<PinnedPlayerRow[]>(
    `SELECT brawlhalla_id::int, position, pinned_at
     FROM accounts.saved_player_pins
     WHERE account_id = $1
     ORDER BY position, brawlhalla_id`,
    [accountId],
  )
  return rows.map(mapPinnedPlayer)
}

function mapSavedPlayer({ brawlhalla_id, position, pin_position, saved_at }: SavedPlayerRow): SavedPlayer {
  return {
    brawlhallaId: brawlhalla_id,
    order: position,
    pinOrder: pin_position,
    savedAt: saved_at,
  }
}

function mapPinnedPlayer({ brawlhalla_id, position, pinned_at }: PinnedPlayerRow): PinnedPlayer {
  return {
    brawlhallaId: brawlhalla_id,
    order: position,
    pinnedAt: pinned_at,
  }
}

function mapPreferences(row: PreferencesRow): AccountPreferences | null {
  if (
    row.schema_version !== 1 ||
    !LEADERBOARD_BRACKETS.includes(row.leaderboard_bracket as AccountPreferences['leaderboardBracket']) ||
    !LEADERBOARD_REGIONS.includes(row.leaderboard_region as AccountPreferences['leaderboardRegion'])
  ) {
    return null
  }
  return {
    version: 1,
    leaderboardBracket: row.leaderboard_bracket as AccountPreferences['leaderboardBracket'],
    leaderboardRegion: row.leaderboard_region as AccountPreferences['leaderboardRegion'],
  }
}

async function findVerificationAttempt(
  client: Sql | TransactionSql,
  attemptId: string,
): Promise<VerificationAttemptRow | null> {
  const [attempt] = await client.unsafe<VerificationAttemptRow[]>(
    `${verificationAttemptQuery} WHERE attempts.id = $1`,
    [attemptId],
  )
  return attempt ?? null
}

function mapVerificationAttempt(row: VerificationAttemptRow): PrimaryPlayerVerificationAttempt {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    player:
      row.brawlhalla_id === null
        ? null
        : {
            brawlhallaId: row.brawlhalla_id,
            name: row.player_name,
          },
  }
}

function mapVerificationState(
  primary: PrimaryPlayerRow | undefined,
  attempts: VerificationAttemptRow[],
): PrimaryPlayerVerificationState {
  return {
    primaryPlayer: primary
      ? {
          brawlhallaId: primary.brawlhalla_id,
          name: primary.player_name,
          verifiedAt: primary.verified_at,
        }
      : null,
    attempts: attempts.map(mapVerificationAttempt),
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

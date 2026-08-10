import { createHash, randomBytes, randomUUID } from 'node:crypto'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_EXTEND_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

export const MAX_SAVED_PLAYERS = 100
export const MAX_PINNED_PLAYERS = 4

export interface Account {
  id: string
  displayName: string
  avatarUrl: string | null
  createdAt: Date
}

export const LEADERBOARD_BRACKETS = ['1v1', '2v2', 'solo2v2', '3v3'] as const
export const LEADERBOARD_REGIONS = ['all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const

export interface AccountPreferences {
  version: 1
  leaderboardBracket: (typeof LEADERBOARD_BRACKETS)[number]
  leaderboardRegion: (typeof LEADERBOARD_REGIONS)[number]
}

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  version: 1,
  leaderboardBracket: '1v1',
  leaderboardRegion: 'all',
}

export class InvalidAccountPreferencesError extends Error {
  constructor() {
    super('Invalid account preferences')
    this.name = 'InvalidAccountPreferencesError'
  }
}

export class InvalidSavedPlayerError extends Error {
  constructor(message = 'Invalid Saved Player') {
    super(message)
    this.name = 'InvalidSavedPlayerError'
  }
}

export interface DiscordSignInProfile {
  providerAccountId: string
  displayName: string
  avatarHash: string | null
}

export type AccountAuthentication =
  | { status: 'anonymous' }
  | {
      status: 'signedIn'
      account: Account
      expiresAt: Date
      extended: boolean
    }

export interface AccountSignIn {
  account: Account
  sessionToken: string
  expiresAt: Date
}

export interface PrimaryPlayerReference {
  brawlhallaId: number
  name: string | null
}

export interface PrimaryPlayer extends PrimaryPlayerReference {
  verifiedAt: Date
}

export interface PrimaryMonitoringTarget {
  assignmentId: string
  brawlhallaId: number
  verifiedAt: Date
}

export interface PrimaryMonitoringSnapshot {
  observedAt: Date
  targets: PrimaryMonitoringTarget[]
}

export type PrimaryPlayerVerificationStatus = 'pending' | 'failed' | 'conflict' | 'verified'

export interface PrimaryPlayerVerificationAttempt {
  id: string
  status: PrimaryPlayerVerificationStatus
  startedAt: Date
  completedAt: Date | null
  player: PrimaryPlayerReference | null
}

export interface PrimaryPlayerVerificationState {
  primaryPlayer: PrimaryPlayer | null
  attempts: PrimaryPlayerVerificationAttempt[]
}

export interface PrimaryPlayerEvidence extends PrimaryPlayerReference {
  name: string
  checkedAt: Date
  source: 'brawlhalla-v0-steam-search'
}

export interface SavedPlayer {
  brawlhallaId: number
  order: number
  pinOrder: number | null
  savedAt: Date
}

export interface PinnedPlayer {
  brawlhallaId: number
  order: number
  pinnedAt: Date
}

export interface PlayerShortcuts {
  primaryPlayer: PrimaryPlayer | null
  pinnedPlayers: PinnedPlayer[]
}

export interface Accounts {
  signInWithDiscord(profile: DiscordSignInProfile): Promise<AccountSignIn>
  authenticate(sessionToken: string | null): Promise<AccountAuthentication>
  signOut(sessionToken: string): Promise<void>
  getPreferences(accountId: string | null): Promise<AccountPreferences>
  updatePreferences(accountId: string, preferences: AccountPreferences): Promise<AccountPreferences>
  beginPrimaryPlayerVerification(input: {
    accountId: string
    steamId: string
    idempotencyKey: string
  }): Promise<PrimaryPlayerVerificationAttempt>
  resolvePrimaryPlayerVerification(
    attemptId: string,
    resolver: { resolve(steamId: string): Promise<PrimaryPlayerEvidence | null> },
  ): Promise<PrimaryPlayerVerificationAttempt>
  getPrimaryPlayerVerificationState(accountId: string): Promise<PrimaryPlayerVerificationState>
  getSavedPlayers(accountId: string): Promise<SavedPlayer[]>
  savePlayer(accountId: string, brawlhallaId: number): Promise<SavedPlayer>
  removeSavedPlayer(accountId: string, brawlhallaId: number): Promise<void>
  reorderSavedPlayers(accountId: string, orderedBrawlhallaIds: readonly number[]): Promise<SavedPlayer[]>
  getPlayerShortcuts(accountId: string): Promise<PlayerShortcuts>
  pinSavedPlayer(accountId: string, brawlhallaId: number): Promise<PinnedPlayer>
  unpinSavedPlayer(accountId: string, brawlhallaId: number): Promise<void>
  reorderPinnedPlayers(accountId: string, orderedBrawlhallaIds: readonly number[]): Promise<PinnedPlayer[]>
}

export interface AccountsStore {
  upsertDiscordIdentity(profile: DiscordSignInProfile): Promise<Account>
  createSession(session: { id: string; accountId: string; expiresAt: Date }): Promise<void>
  findSessionAccount(id: string): Promise<{ account: Account; expiresAt: Date } | null>
  extendSession(id: string, expiresAt: Date): Promise<void>
  deleteSession(id: string): Promise<void>
  findPreferences(accountId: string): Promise<AccountPreferences | null>
  upsertPreferences(accountId: string, preferences: AccountPreferences): Promise<AccountPreferences>
  beginPrimaryPlayerVerification(input: {
    attemptId: string
    accountId: string
    steamId: string
    idempotencyKey: string
    startedAt: Date
  }): Promise<PrimaryPlayerVerificationAttempt>
  findPrimaryPlayerVerificationAttempt(
    attemptId: string,
  ): Promise<{ attempt: PrimaryPlayerVerificationAttempt; steamId: string } | null>
  completePrimaryPlayerVerification(input: {
    attemptId: string
    evidence: PrimaryPlayerEvidence | null
    completedAt: Date
  }): Promise<PrimaryPlayerVerificationAttempt>
  getPrimaryPlayerVerificationState(accountId: string): Promise<PrimaryPlayerVerificationState>
  readPrimaryMonitoringSnapshot(): Promise<PrimaryMonitoringSnapshot>
  getSavedPlayers(accountId: string): Promise<SavedPlayer[]>
  savePlayer(accountId: string, brawlhallaId: number): Promise<SavedPlayer>
  removeSavedPlayer(accountId: string, brawlhallaId: number): Promise<void>
  reorderSavedPlayers(accountId: string, orderedBrawlhallaIds: readonly number[]): Promise<SavedPlayer[]>
  getPlayerShortcuts(accountId: string): Promise<PlayerShortcuts>
  pinSavedPlayer(accountId: string, brawlhallaId: number): Promise<PinnedPlayer>
  unpinSavedPlayer(accountId: string, brawlhallaId: number): Promise<void>
  reorderPinnedPlayers(accountId: string, orderedBrawlhallaIds: readonly number[]): Promise<PinnedPlayer[]>
}

interface CreateAccountsOptions {
  store: AccountsStore
  now?: () => Date
  generateToken?: () => string
  generateId?: () => string
}

export function createAccounts({
  store,
  now = () => new Date(),
  generateToken = () => randomBytes(32).toString('base64url'),
  generateId = randomUUID,
}: CreateAccountsOptions): Accounts {
  return {
    async signInWithDiscord(profile) {
      const account = await store.upsertDiscordIdentity(profile)
      const sessionToken = generateToken()
      const expiresAt = new Date(now().getTime() + SESSION_TTL_MS)
      await store.createSession({ id: hashSessionToken(sessionToken), accountId: account.id, expiresAt })
      return { account, sessionToken, expiresAt }
    },

    async authenticate(sessionToken) {
      if (!sessionToken) return { status: 'anonymous' }

      const sessionId = hashSessionToken(sessionToken)
      const current = await store.findSessionAccount(sessionId)
      const checkedAt = now()
      if (!current || current.expiresAt.getTime() <= checkedAt.getTime()) return { status: 'anonymous' }

      if (current.expiresAt.getTime() - checkedAt.getTime() >= SESSION_EXTEND_THRESHOLD_MS) {
        return { status: 'signedIn', account: current.account, expiresAt: current.expiresAt, extended: false }
      }

      const expiresAt = new Date(checkedAt.getTime() + SESSION_TTL_MS)
      await store.extendSession(sessionId, expiresAt)
      return { status: 'signedIn', account: current.account, expiresAt, extended: true }
    },

    async signOut(sessionToken) {
      await store.deleteSession(hashSessionToken(sessionToken))
    },

    async getPreferences(accountId) {
      if (!accountId) return { ...DEFAULT_ACCOUNT_PREFERENCES }
      return (await store.findPreferences(accountId)) ?? { ...DEFAULT_ACCOUNT_PREFERENCES }
    },

    async updatePreferences(accountId, preferences) {
      if (!validPreferences(preferences)) throw new InvalidAccountPreferencesError()
      return store.upsertPreferences(accountId, preferences)
    },

    async beginPrimaryPlayerVerification(input) {
      return store.beginPrimaryPlayerVerification({
        ...input,
        attemptId: generateId(),
        startedAt: now(),
      })
    },

    async resolvePrimaryPlayerVerification(attemptId, resolver) {
      const pending = await store.findPrimaryPlayerVerificationAttempt(attemptId)
      if (!pending) throw new Error('Unknown Primary Player verification attempt')
      if (pending.attempt.status !== 'pending') return pending.attempt
      const evidence = await resolver.resolve(pending.steamId)
      return store.completePrimaryPlayerVerification({ attemptId, evidence, completedAt: now() })
    },

    getPrimaryPlayerVerificationState(accountId) {
      return store.getPrimaryPlayerVerificationState(accountId)
    },

    getSavedPlayers(accountId) {
      return store.getSavedPlayers(accountId)
    },

    savePlayer(accountId, brawlhallaId) {
      requireBrawlhallaId(brawlhallaId)
      return store.savePlayer(accountId, brawlhallaId)
    },

    removeSavedPlayer(accountId, brawlhallaId) {
      requireBrawlhallaId(brawlhallaId)
      return store.removeSavedPlayer(accountId, brawlhallaId)
    },

    reorderSavedPlayers(accountId, orderedBrawlhallaIds) {
      if (new Set(orderedBrawlhallaIds).size !== orderedBrawlhallaIds.length) {
        throw new InvalidSavedPlayerError('Saved Player order contains duplicate players')
      }
      for (const brawlhallaId of orderedBrawlhallaIds) requireBrawlhallaId(brawlhallaId)
      return store.reorderSavedPlayers(accountId, orderedBrawlhallaIds)
    },

    getPlayerShortcuts(accountId) {
      return store.getPlayerShortcuts(accountId)
    },

    pinSavedPlayer(accountId, brawlhallaId) {
      requireBrawlhallaId(brawlhallaId)
      return store.pinSavedPlayer(accountId, brawlhallaId)
    },

    unpinSavedPlayer(accountId, brawlhallaId) {
      requireBrawlhallaId(brawlhallaId)
      return store.unpinSavedPlayer(accountId, brawlhallaId)
    },

    reorderPinnedPlayers(accountId, orderedBrawlhallaIds) {
      if (new Set(orderedBrawlhallaIds).size !== orderedBrawlhallaIds.length) {
        throw new InvalidSavedPlayerError('Pinned Player order contains duplicate players')
      }
      if (orderedBrawlhallaIds.length > MAX_PINNED_PLAYERS) {
        throw new InvalidSavedPlayerError(`Pinned Players cannot exceed ${MAX_PINNED_PLAYERS}`)
      }
      for (const brawlhallaId of orderedBrawlhallaIds) requireBrawlhallaId(brawlhallaId)
      return store.reorderPinnedPlayers(accountId, orderedBrawlhallaIds)
    },
  }
}

function requireBrawlhallaId(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new InvalidSavedPlayerError('Invalid Brawlhalla player ID')
  }
}

function validPreferences(preferences: unknown): preferences is AccountPreferences {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return false
  const value = preferences as Record<string, unknown>
  const keys = Object.keys(value)
  return (
    keys.length === 3 &&
    keys.every((key) => ['version', 'leaderboardBracket', 'leaderboardRegion'].includes(key)) &&
    value.version === 1 &&
    LEADERBOARD_BRACKETS.includes(value.leaderboardBracket as AccountPreferences['leaderboardBracket']) &&
    LEADERBOARD_REGIONS.includes(value.leaderboardRegion as AccountPreferences['leaderboardRegion'])
  )
}

function hashSessionToken(sessionToken: string): string {
  return createHash('sha256').update(sessionToken).digest('hex')
}

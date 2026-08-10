import { describe, expect, test } from 'bun:test'
import {
  type Account,
  type AccountPreferences,
  type Accounts,
  DEFAULT_ACCOUNT_PREFERENCES,
  InvalidSavedPlayerError,
  type SavedPlayer,
} from '@brawltome/accounts'
import {
  accountPreferencesSchema,
  accountViewSchema,
  playerShortcutsSchema,
  primaryPlayerVerificationStateSchema,
  savedPlayersSchema,
} from '@brawltome/contracts'
import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { toAccountPreferences, toAccountView, toPrimaryPlayerVerificationState } from '../src/mappers/account.mapper'
import { accountRouter } from '../src/router/account.router'

interface TestContext {
  account: Account | null
  accounts: Accounts
  playerReferenceQueries: { byId(id: number): Promise<{ brawlhallaId: number; name: string } | null> }
  rankedPlayerQueries: { byId(id: number): Promise<unknown> }
}

const t = initTRPC.context<TestContext>().create({ transformer: superjson })
const caller = t.createCallerFactory(accountRouter as unknown as ReturnType<typeof t.router>)

const accounts = {
  async signInWithDiscord() {
    throw new Error('not used')
  },
  async authenticate() {
    return { status: 'anonymous' }
  },
  async signOut() {},
  async getPreferences() {
    return DEFAULT_ACCOUNT_PREFERENCES
  },
  async updatePreferences(_accountId, preferences) {
    return preferences
  },
  async beginPrimaryPlayerVerification() {
    throw new Error('not used')
  },
  async resolvePrimaryPlayerVerification() {
    throw new Error('not used')
  },
  async getPrimaryPlayerVerificationState() {
    return {
      primaryPlayer: { brawlhallaId: 42, name: 'Ada', verifiedAt: new Date('2026-08-10T10:02:00.000Z') },
      attempts: [
        {
          id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
          status: 'verified' as const,
          startedAt: new Date('2026-08-10T10:00:00.000Z'),
          completedAt: new Date('2026-08-10T10:02:00.000Z'),
          player: { brawlhallaId: 42, name: 'Ada' },
        },
      ],
    }
  },
  async getSavedPlayers() {
    return []
  },
  async savePlayer(_accountId, brawlhallaId) {
    return { brawlhallaId, order: 0, pinOrder: null, savedAt: new Date('2026-08-10T10:03:00.000Z') }
  },
  async removeSavedPlayer() {},
  async reorderSavedPlayers() {
    return []
  },
  async getPlayerShortcuts() {
    return { primaryPlayer: null, pinnedPlayers: [] }
  },
  async pinSavedPlayer(_accountId, brawlhallaId) {
    return { brawlhallaId, order: 0, pinnedAt: new Date('2026-08-10T10:04:00.000Z') }
  },
  async unpinSavedPlayer() {},
  async reorderPinnedPlayers() {
    return []
  },
} satisfies Accounts

const account: Account = {
  id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
  displayName: 'Ada',
  avatarUrl: null,
  createdAt: new Date('2026-08-09T18:42:01.000Z'),
}

function makeAccounts() {
  let preferences: AccountPreferences = { ...DEFAULT_ACCOUNT_PREFERENCES }
  let savedPlayers: SavedPlayer[] = []
  let pinnedIds: number[] = []
  const updatePinOrder = () => {
    savedPlayers = savedPlayers.map((player) => ({
      ...player,
      pinOrder: pinnedIds.indexOf(player.brawlhallaId) < 0 ? null : pinnedIds.indexOf(player.brawlhallaId),
    }))
  }
  const service: Accounts = {
    async signInWithDiscord() {
      throw new Error('Not used')
    },
    async authenticate() {
      return { status: 'anonymous' }
    },
    async signOut() {},
    async getPreferences() {
      return preferences
    },
    async updatePreferences(_accountId, nextPreferences) {
      preferences = nextPreferences
      return preferences
    },
    async beginPrimaryPlayerVerification() {
      throw new Error('Not used')
    },
    async resolvePrimaryPlayerVerification() {
      throw new Error('Not used')
    },
    async getPrimaryPlayerVerificationState() {
      return { primaryPlayer: null, attempts: [] }
    },
    async getSavedPlayers() {
      return savedPlayers
    },
    async savePlayer(_accountId, brawlhallaId) {
      const existing = savedPlayers.find((savedPlayer) => savedPlayer.brawlhallaId === brawlhallaId)
      if (existing) return existing
      const savedPlayer = {
        brawlhallaId,
        order: savedPlayers.length,
        pinOrder: null,
        savedAt: new Date('2026-08-10T10:03:00.000Z'),
      }
      savedPlayers = [...savedPlayers, savedPlayer]
      return savedPlayer
    },
    async removeSavedPlayer(_accountId, brawlhallaId) {
      savedPlayers = savedPlayers
        .filter((savedPlayer) => savedPlayer.brawlhallaId !== brawlhallaId)
        .map((savedPlayer, order) => ({ ...savedPlayer, order }))
      pinnedIds = pinnedIds.filter((id) => id !== brawlhallaId)
      updatePinOrder()
    },
    async reorderSavedPlayers(_accountId, orderedBrawlhallaIds) {
      savedPlayers = orderedBrawlhallaIds.map((brawlhallaId, order) => ({
        ...(savedPlayers.find((savedPlayer) => savedPlayer.brawlhallaId === brawlhallaId) as SavedPlayer),
        order,
      }))
      return savedPlayers
    },
    async getPlayerShortcuts() {
      return {
        primaryPlayer: null,
        pinnedPlayers: pinnedIds.map((brawlhallaId, order) => ({
          brawlhallaId,
          order,
          pinnedAt: new Date('2026-08-10T10:04:00.000Z'),
        })),
      }
    },
    async pinSavedPlayer(_accountId, brawlhallaId) {
      if (!pinnedIds.includes(brawlhallaId)) pinnedIds.push(brawlhallaId)
      updatePinOrder()
      return { brawlhallaId, order: pinnedIds.indexOf(brawlhallaId), pinnedAt: new Date('2026-08-10T10:04:00.000Z') }
    },
    async unpinSavedPlayer(_accountId, brawlhallaId) {
      pinnedIds = pinnedIds.filter((id) => id !== brawlhallaId)
      updatePinOrder()
    },
    async reorderPinnedPlayers(_accountId, orderedBrawlhallaIds) {
      pinnedIds = [...orderedBrawlhallaIds]
      updatePinOrder()
      return (await service.getPlayerShortcuts(_accountId)).pinnedPlayers
    },
  }
  return service
}

function context(currentAccount: Account | null, accountService = makeAccounts()): TestContext {
  return {
    account: currentAccount,
    accounts: accountService,
    playerReferenceQueries: {
      async byId(id) {
        return id === 404 ? null : { brawlhallaId: id, name: `Player ${id}` }
      },
    },
    rankedPlayerQueries: {
      async byId(id) {
        return {
          brawlhallaId: id,
          checkedAt: new Date('2026-08-10T10:00:00.000Z'),
          lastSuccessAt: null,
          freshness: 'unavailable',
          freshForSeconds: 3_600,
          sparsePulse: null,
          snapshot: null,
        }
      },
    },
  }
}

describe('account.current', () => {
  test('returns the canonical anonymous view', async () => {
    const result = await (caller(context(null)) as { current: () => Promise<unknown> }).current()
    expect(result).toEqual({ status: 'anonymous' })
    expect(accountViewSchema.parse(result)).toEqual({ status: 'anonymous' })
  })

  test('rejects malformed producer output', () => {
    expect(() => toAccountView({ ...account, id: 'not-a-uuid' })).toThrow()
  })

  test('returns the canonical signed-in view with an ISO UTC timestamp', async () => {
    const result = await (caller(context(account)) as { current: () => Promise<unknown> }).current()
    expect(result).toEqual({
      status: 'signedIn',
      account: {
        id: account.id,
        displayName: 'Ada',
        avatarUrl: null,
        createdAt: '2026-08-09T18:42:01.000Z',
      },
    })
  })

  test('returns canonical Primary Player ownership and privacy-safe attempt history', async () => {
    const result = await (
      caller(context(account, accounts)) as { primaryPlayer: () => Promise<unknown> }
    ).primaryPlayer()

    expect(primaryPlayerVerificationStateSchema.parse(result)).toEqual({
      primaryPlayer: { brawlhallaId: 42, name: 'Ada', verifiedAt: '2026-08-10T10:02:00.000Z' },
      attempts: [
        {
          id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
          status: 'verified',
          startedAt: '2026-08-10T10:00:00.000Z',
          completedAt: '2026-08-10T10:02:00.000Z',
          player: { brawlhallaId: 42, name: 'Ada' },
        },
      ],
    })
  })

  test('rejects malformed Primary Player producer state', () => {
    expect(() =>
      toPrimaryPlayerVerificationState({
        primaryPlayer: null,
        attempts: [
          {
            id: 'not-a-uuid',
            status: 'pending',
            startedAt: new Date(),
            completedAt: null,
            player: null,
          },
        ],
      }),
    ).toThrow()
  })
})

describe('account.playerShortcuts', () => {
  test('returns Primary first as You-ready data followed by ordered pins with effective-main facts', async () => {
    const shortcutAccounts: Accounts = {
      ...makeAccounts(),
      async getPlayerShortcuts() {
        return {
          primaryPlayer: { brawlhallaId: 42, name: 'Stored Ada', verifiedAt: new Date('2026-08-10T10:02:00Z') },
          pinnedPlayers: [
            { brawlhallaId: 44, order: 0, pinnedAt: new Date('2026-08-10T10:03:00Z') },
            { brawlhallaId: 43, order: 1, pinnedAt: new Date('2026-08-10T10:04:00Z') },
          ],
        }
      },
    }
    const shortcutContext = context(account, shortcutAccounts)
    shortcutContext.rankedPlayerQueries.byId = async (id) => ({
      brawlhallaId: id,
      checkedAt: new Date('2026-08-10T10:00:00.000Z'),
      lastSuccessAt: new Date('2026-08-10T10:00:00.000Z'),
      freshness: 'fresh',
      freshForSeconds: 3_600,
      sparsePulse: null,
      snapshot: {
        oneVsOne: {
          rating: 1_700,
          peakRating: 1_700,
          tier: 'Platinum',
          wins: 1,
          games: 2,
          region: 'US-E',
          globalRank: null,
          regionRank: null,
        },
        rankedLegends: [],
        mainLegend:
          id === 43
            ? null
            : {
                legendId: id,
                legendNameKey: id === 42 ? 'bodvar' : 'orion',
                source: id === 42 ? 'current-season' : 'career',
              },
        fixedTeams: [],
        soloQueue: [],
        ratingHistory: [],
        observedRatingDirection: null,
      },
    })
    const api = caller(shortcutContext) as { playerShortcuts: () => Promise<unknown> }

    expect(playerShortcutsSchema.parse(await api.playerShortcuts())).toEqual({
      primary: {
        brawlhallaId: 42,
        name: 'Player 42',
        mainLegend: { legendNameKey: 'bodvar', source: 'current-season' },
      },
      pins: [
        {
          brawlhallaId: 44,
          name: 'Player 44',
          mainLegend: { legendNameKey: 'orion', source: 'career' },
        },
        { brawlhallaId: 43, name: 'Player 43', mainLegend: null },
      ],
    })
  })

  test('rejects anonymous shortcut reads and pin mutations without disclosing state', async () => {
    const api = caller(context(null)) as {
      playerShortcuts: () => Promise<unknown>
      pinSavedPlayer: (input: unknown) => Promise<unknown>
    }
    await expect(api.playerShortcuts()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(api.pinSavedPlayer({ brawlhallaId: 42 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('account.savedPlayers', () => {
  test('returns canonical Player Profile facts for session-owned bookmarks only', async () => {
    const accountService = makeAccounts()
    const api = caller(context(account, accountService)) as {
      savedPlayers: () => Promise<unknown>
      savePlayer: (input: unknown) => Promise<unknown>
    }

    expect(await api.savedPlayers()).toEqual([])
    const result = await api.savePlayer({ brawlhallaId: 42 })

    expect(savedPlayersSchema.parse(result)).toEqual([
      {
        brawlhallaId: 42,
        order: 0,
        pinOrder: null,
        savedAt: '2026-08-10T10:03:00.000Z',
        player: { brawlhallaId: 42, name: 'Player 42' },
        currentSeason: {
          brawlhallaId: 42,
          checkedAt: '2026-08-10T10:00:00.000Z',
          lastSuccessAt: null,
          freshness: 'unavailable',
          freshForSeconds: 3_600,
          sparsePulse: null,
          snapshot: null,
        },
      },
    ])
  })

  test('supports idempotent remove and complete manual reorder through protected procedures', async () => {
    const api = caller(context(account)) as {
      savePlayer: (input: unknown) => Promise<unknown>
      removeSavedPlayer: (input: unknown) => Promise<unknown>
      reorderSavedPlayers: (input: unknown) => Promise<unknown>
    }
    await api.savePlayer({ brawlhallaId: 42 })
    await api.savePlayer({ brawlhallaId: 43 })

    const reordered = savedPlayersSchema.parse(await api.reorderSavedPlayers({ brawlhallaIds: [43, 42] }))
    expect(reordered.map(({ brawlhallaId, order }) => ({ brawlhallaId, order }))).toEqual([
      { brawlhallaId: 43, order: 0 },
      { brawlhallaId: 42, order: 1 },
    ])
    expect(await api.removeSavedPlayer({ brawlhallaId: 43 })).toHaveLength(1)
    expect(await api.removeSavedPlayer({ brawlhallaId: 43 })).toHaveLength(1)
  })

  test('pins, unpins, and independently reorders the authenticated Saved Player subset', async () => {
    const api = caller(context(account)) as {
      savePlayer: (input: unknown) => Promise<unknown>
      pinSavedPlayer: (input: unknown) => Promise<unknown>
      unpinSavedPlayer: (input: unknown) => Promise<unknown>
      reorderPinnedPlayers: (input: unknown) => Promise<unknown>
    }
    await api.savePlayer({ brawlhallaId: 42 })
    await api.savePlayer({ brawlhallaId: 43 })
    await api.pinSavedPlayer({ brawlhallaId: 42 })
    const pinned = savedPlayersSchema.parse(await api.pinSavedPlayer({ brawlhallaId: 43 }))
    expect(pinned.map(({ brawlhallaId, pinOrder }) => ({ brawlhallaId, pinOrder }))).toEqual([
      { brawlhallaId: 42, pinOrder: 0 },
      { brawlhallaId: 43, pinOrder: 1 },
    ])

    const reordered = savedPlayersSchema.parse(await api.reorderPinnedPlayers({ brawlhallaIds: [43, 42] }))
    expect(reordered.map(({ brawlhallaId, pinOrder }) => ({ brawlhallaId, pinOrder }))).toEqual([
      { brawlhallaId: 42, pinOrder: 1 },
      { brawlhallaId: 43, pinOrder: 0 },
    ])
    const unpinned = savedPlayersSchema.parse(await api.unpinSavedPlayer({ brawlhallaId: 43 }))
    expect(unpinned.map(({ brawlhallaId, pinOrder }) => ({ brawlhallaId, pinOrder }))).toEqual([
      { brawlhallaId: 42, pinOrder: 0 },
      { brawlhallaId: 43, pinOrder: null },
    ])
  })

  test('rejects anonymous access, client-supplied account identity, and unknown players', async () => {
    const anonymousApi = caller(context(null)) as {
      savedPlayers: () => Promise<unknown>
      savePlayer: (input: unknown) => Promise<unknown>
      removeSavedPlayer: (input: unknown) => Promise<unknown>
      reorderSavedPlayers: (input: unknown) => Promise<unknown>
    }
    await expect(anonymousApi.savedPlayers()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(anonymousApi.savePlayer({ brawlhallaId: 42 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(anonymousApi.removeSavedPlayer({ brawlhallaId: 42 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(anonymousApi.reorderSavedPlayers({ brawlhallaIds: [] })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })

    const signedInApi = caller(context(account)) as { savePlayer: (input: unknown) => Promise<unknown> }
    await expect(
      signedInApi.savePlayer({ brawlhallaId: 42, accountId: 'd6bf157b-9c07-4ce3-9924-a053a28a59bb' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(signedInApi.savePlayer({ brawlhallaId: 404 })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const limitedAccounts: Accounts = {
      ...makeAccounts(),
      async savePlayer() {
        throw new InvalidSavedPlayerError('Saved Players cannot exceed 100')
      },
    }
    const limitedApi = caller(context(account, limitedAccounts)) as { savePlayer: (input: unknown) => Promise<unknown> }
    await expect(limitedApi.savePlayer({ brawlhallaId: 42 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('account.preferences', () => {
  test('returns canonical defaults without requiring or exposing an account', async () => {
    const result = await (caller(context(null)) as { preferences: () => Promise<unknown> }).preferences()

    expect(result).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
    expect(accountPreferencesSchema.parse(result)).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
  })

  test('round-trips a validated update for the authenticated account', async () => {
    const api = caller(context(account)) as {
      preferences: () => Promise<unknown>
      updatePreferences: (input: AccountPreferences) => Promise<unknown>
    }
    const updated = { version: 1 as const, leaderboardBracket: '2v2' as const, leaderboardRegion: 'US-W' as const }

    expect(await api.updatePreferences(updated)).toEqual(updated)
    expect(await api.preferences()).toEqual(updated)
  })

  test('rejects anonymous updates and unknown fields', async () => {
    const anonymousApi = caller(context(null)) as {
      updatePreferences: (input: unknown) => Promise<unknown>
    }
    const signedInApi = caller(context(account)) as {
      updatePreferences: (input: unknown) => Promise<unknown>
    }

    await expect(anonymousApi.updatePreferences(DEFAULT_ACCOUNT_PREFERENCES)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(
      signedInApi.updatePreferences({ ...DEFAULT_ACCOUNT_PREFERENCES, theme: 'dark' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  test('rejects unsupported producer output', () => {
    expect(() =>
      toAccountPreferences({
        version: 2,
        leaderboardBracket: '1v1',
        leaderboardRegion: 'all',
      } as never),
    ).toThrow()
  })
})

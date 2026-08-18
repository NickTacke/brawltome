import { describe, expect, test } from 'bun:test'
import {
  MAX_PINNED_PLAYERS,
  type PinnedPlayersContract,
  type PrimaryPlayerVerificationStateContract,
  accountPreferencesSchema,
  accountViewSchema,
  parseAccountViewOutput,
  parsePinnedPlayersOutput,
  parsePlayerShortcutsOutput,
  parsePrimaryPlayerVerificationStateOutput,
  pinnedPlayerOrderInputSchema,
} from '../src/account'

const signedInView = {
  status: 'signedIn' as const,
  account: {
    id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
    displayName: 'Ada',
    avatarUrl: null,
    createdAt: '2026-08-09T18:42:01.000Z',
  },
}

describe('accountPreferencesSchema', () => {
  test('defines only the launch-consumed leaderboard preferences in version 1', () => {
    const preferences = {
      version: 1 as const,
      leaderboardBracket: 'solo2v2' as const,
      leaderboardRegion: 'EU' as const,
    }

    expect(accountPreferencesSchema.parse(preferences)).toEqual(preferences)
  })

  test('rejects unknown, retired, partial, and unsupported preferences', () => {
    expect(() =>
      accountPreferencesSchema.parse({
        version: 1,
        leaderboardBracket: '1v1',
        leaderboardRegion: 'all',
        theme: 'dark',
      }),
    ).toThrow()
    expect(() => accountPreferencesSchema.parse({ version: 1, leaderboardBracket: '1v1' })).toThrow()
    expect(() =>
      accountPreferencesSchema.parse({
        version: 2,
        leaderboardBracket: '1v1',
        leaderboardRegion: 'all',
      }),
    ).toThrow()
  })
})

describe('accountViewSchema', () => {
  test('represents anonymous and signed-in account views', () => {
    expect(parseAccountViewOutput({ status: 'anonymous' })).toEqual({ status: 'anonymous' })
    expect(parseAccountViewOutput(signedInView)).toEqual(signedInView)
  })

  test('accepts a canonical avatar URL', () => {
    const result = accountViewSchema.parse({
      ...signedInView,
      account: { ...signedInView.account, avatarUrl: 'https://cdn.discordapp.com/avatar.png' },
    })
    if (result.status !== 'signedIn') throw new Error('Expected signed-in account')
    expect(result.account).toMatchObject({ avatarUrl: 'https://cdn.discordapp.com/avatar.png' })
  })

  test('rejects non-UTC timestamps and persistence details', () => {
    expect(() =>
      accountViewSchema.parse({
        ...signedInView,
        account: { ...signedInView.account, createdAt: '2026-08-09T19:42:01+01:00' },
      }),
    ).toThrow()
    expect(() =>
      accountViewSchema.parse({
        ...signedInView,
        account: { ...signedInView.account, providerAccountId: 'discord-42' },
      }),
    ).toThrow()
    expect(() => accountViewSchema.parse({ status: 'anonymous', session: { id: 'secret' } })).toThrow()
  })
})

describe('pinnedPlayersSchema', () => {
  const pinnedPlayer = {
    brawlhallaId: 42,
    order: 0,
    pinnedAt: '2026-08-10T09:00:00.000Z',
    player: { brawlhallaId: 42, name: 'Ada', aliases: [] },
    currentSeason: {
      brawlhallaId: 42,
      checkedAt: '2026-08-10T10:00:00.000Z',
      lastSuccessAt: null,
      freshness: 'unavailable' as const,
      freshForSeconds: 3_600,
      sparsePulse: null,
      snapshot: null,
    },
  }

  test('preserves canonical Player Profile observation facts without ownership or follow semantics', () => {
    const pinnedPlayers: PinnedPlayersContract = [pinnedPlayer]

    expect(parsePinnedPlayersOutput(pinnedPlayers)).toEqual(pinnedPlayers)
    expect(() => parsePinnedPlayersOutput([{ ...pinnedPlayers[0], accountId: signedInView.account.id }])).toThrow()
    expect(() => parsePinnedPlayersOutput([{ ...pinnedPlayers[0], following: true }])).toThrow()
    expect(() =>
      parsePinnedPlayersOutput([
        {
          ...pinnedPlayers[0],
          player: { brawlhallaId: 43, name: 'Different player', aliases: [] },
        },
      ]),
    ).toThrow()
  })

  test('keeps the add cap separate from the legacy collection output cap', () => {
    expect(MAX_PINNED_PLAYERS).toBe(20)
    const legacyTwentyOnePlayers = Array.from({ length: 21 }, (_, index) => ({
      ...pinnedPlayer,
      brawlhallaId: index + 1,
      order: index,
      player: { brawlhallaId: index + 1, name: `Player ${index + 1}`, aliases: [] },
      currentSeason: null,
    }))

    expect(parsePinnedPlayersOutput(legacyTwentyOnePlayers)).toHaveLength(21)
    expect(() =>
      parsePinnedPlayersOutput(
        Array.from({ length: 101 }, (_, index) => ({
          ...pinnedPlayer,
          brawlhallaId: index + 1,
          order: index,
          player: null,
          currentSeason: null,
        })),
      ),
    ).toThrow()
  })

  test('requires a complete duplicate-free order payload shape', () => {
    expect(pinnedPlayerOrderInputSchema.parse({ brawlhallaIds: [43, 42] })).toEqual({ brawlhallaIds: [43, 42] })
    expect(() => pinnedPlayerOrderInputSchema.parse({ brawlhallaIds: [42, 42] })).toThrow()
    expect(() =>
      pinnedPlayerOrderInputSchema.parse({ brawlhallaIds: Array.from({ length: 101 }, (_, index) => index + 1) }),
    ).toThrow()
    expect(() =>
      pinnedPlayerOrderInputSchema.parse({ accountId: signedInView.account.id, brawlhallaIds: [42] }),
    ).toThrow()
  })
})

describe('playerShortcutsSchema', () => {
  test('keeps Primary structurally first and publishes only effective-main avatar facts', () => {
    const shortcuts = {
      primary: {
        brawlhallaId: 42,
        name: 'Ada',
        mainLegend: { legendNameKey: 'bodvar', source: 'current-season' as const },
      },
      pins: [
        {
          brawlhallaId: 43,
          name: 'Lin',
          mainLegend: { legendNameKey: 'orion', source: 'career' as const },
        },
      ],
    }

    expect(parsePlayerShortcutsOutput(shortcuts)).toEqual(shortcuts)
    expect(() => parsePlayerShortcutsOutput({ ...shortcuts, accountId: signedInView.account.id })).toThrow()
    expect(() => parsePlayerShortcutsOutput({ ...shortcuts, pins: [...shortcuts.pins, shortcuts.primary] })).toThrow()
    expect(() =>
      parsePlayerShortcutsOutput({
        ...shortcuts,
        pins: Array.from({ length: 101 }, (_, index) => ({
          ...shortcuts.pins[0],
          brawlhallaId: index + 1,
        })),
      }),
    ).toThrow()
  })

  test('bounds a duplicate-free complete pin order payload', () => {
    expect(pinnedPlayerOrderInputSchema.parse({ brawlhallaIds: [43, 42] })).toEqual({ brawlhallaIds: [43, 42] })
    expect(() => pinnedPlayerOrderInputSchema.parse({ brawlhallaIds: [42, 42] })).toThrow()
    expect(() =>
      pinnedPlayerOrderInputSchema.parse({ brawlhallaIds: Array.from({ length: 101 }, (_, index) => index + 1) }),
    ).toThrow()
  })
})

describe('primaryPlayerVerificationStateSchema', () => {
  test('exposes ownership and immutable attempt history without proof subjects', () => {
    const state: PrimaryPlayerVerificationStateContract = {
      primaryPlayer: {
        brawlhallaId: 42,
        name: 'Ada',
        verifiedAt: '2026-08-10T10:02:00.000Z',
      },
      attempts: [
        {
          id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
          status: 'verified',
          startedAt: '2026-08-10T10:00:00.000Z',
          completedAt: '2026-08-10T10:02:00.000Z',
          player: { brawlhallaId: 42, name: 'Ada' },
        },
        {
          id: '96750f84-193c-42e4-a02e-b955af34d397',
          status: 'conflict',
          startedAt: '2026-08-09T10:00:00.000Z',
          completedAt: '2026-08-09T10:02:00.000Z',
          player: null,
        },
      ],
    }

    expect(parsePrimaryPlayerVerificationStateOutput(state)).toEqual(state)
    expect(() =>
      parsePrimaryPlayerVerificationStateOutput({
        ...state,
        attempts: [{ ...state.attempts[0], steamId: 'private-proof-subject' }],
      }),
    ).toThrow()
  })

  test('rejects impossible pending and verified states', () => {
    const base = {
      id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
      startedAt: '2026-08-10T10:00:00.000Z',
      completedAt: '2026-08-10T10:02:00.000Z',
      player: null,
    }
    expect(() =>
      parsePrimaryPlayerVerificationStateOutput({
        primaryPlayer: null,
        attempts: [{ ...base, status: 'pending' }],
      }),
    ).toThrow()
    expect(() =>
      parsePrimaryPlayerVerificationStateOutput({
        primaryPlayer: null,
        attempts: [{ ...base, status: 'verified' }],
      }),
    ).toThrow()
  })
})

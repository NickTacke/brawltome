import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@/lib/auth', () => ({
  linkSteam: () => {},
  saveAccountPreferences: async (_queryClient: unknown, _accountId: string, preferences: unknown) => preferences,
  signOut: () => {},
  useAccountPreferences: () => ({
    isLoading: false,
    preferences: { version: 2, leaderboardBracket: '1v1', leaderboardRegion: 'all', theme: 'purple' },
  }),
  usePrimaryPlayer: () => ({
    isError: false,
    isLoading: false,
    state: { attempts: [], primaryPlayer: null },
  }),
}))
mock.module('@/lib/pinnedPlayers', () => ({
  movePinnedPlayer: () => [],
  reorderPinnedPlayers: async () => [],
  unpinPlayer: async () => [],
  usePinnedPlayers: () => ({ isError: false, isLoading: false, pinnedPlayers: [] }),
}))
mock.module('@/lib/playerShortcuts', () => ({ invalidatePlayerNavigation: async () => {} }))
mock.module('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))

const { SignedInState } = await import('../../../src/app/account/SignedInState')

const account = {
  id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
  displayName: 'Ada',
  avatarUrl: null,
  createdAt: '2026-08-09T18:42:01.000Z',
}

describe('SignedInState appearance settings', () => {
  test('renders the account theme choices', () => {
    const html = renderToStaticMarkup(<SignedInState account={account} />)

    expect(html).toContain('Appearance')
    expect(html).toContain('Theme')
    expect(html).toContain('Neutral')
    expect(html).toContain('Purple')
  })
})

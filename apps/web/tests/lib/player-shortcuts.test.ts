import { describe, expect, test } from 'bun:test'
import type { PlayerShortcutsContract } from '@brawltome/contracts'
import {
  createPlayerShortcutNavigation,
  invalidatePlayerNavigation,
  parsePlayerShortcutsResponse,
} from '../../src/lib/playerShortcuts'

const shortcuts: PlayerShortcutsContract = {
  primary: {
    brawlhallaId: 42,
    name: 'Ada',
    mainLegend: { legendNameKey: 'lord vraxx', source: 'current-season' },
  },
  pins: [
    {
      brawlhallaId: 44,
      name: 'Lin',
      mainLegend: { legendNameKey: 'orion', source: 'career' },
    },
    { brawlhallaId: 43, name: null, mainLegend: null },
  ],
}

describe('private Player shortcut navigation', () => {
  test('derives Primary first as You followed by every ordered Pinned Player', () => {
    expect(createPlayerShortcutNavigation(shortcuts)).toEqual([
      {
        kind: 'primary',
        href: '/player/42',
        label: 'You',
        accessibleLabel: 'You, Ada',
        avatarUrl: '/images/legends/avatars/lord%20vraxx.png',
      },
      {
        kind: 'pin',
        href: '/player/44',
        label: 'Lin',
        accessibleLabel: 'Pinned Player, Lin',
        avatarUrl: '/images/legends/avatars/orion.png',
      },
      {
        kind: 'pin',
        href: '/player/43',
        label: 'Player ID 43',
        accessibleLabel: 'Pinned Player, Player ID 43',
        avatarUrl: null,
      },
    ])
  })

  test('preserves every ordered Pinned Player without a synthetic destination', () => {
    const pins = Array.from({ length: 21 }, (_, index) => ({
      brawlhallaId: 100 + index,
      name: `Player ${index}`,
      mainLegend: null,
    }))
    const navigation = createPlayerShortcutNavigation({ primary: null, pins })

    expect(navigation).toHaveLength(pins.length)
    expect(navigation.map(({ kind, href }) => [kind, href])).toEqual(
      pins.map(({ brawlhallaId }) => ['pin', `/player/${brawlhallaId}`]),
    )
  })

  test('returns no private destinations without an authenticated shortcut contract', () => {
    expect(createPlayerShortcutNavigation(null)).toEqual([])
    expect(() => parsePlayerShortcutsResponse({ ...shortcuts, public: true })).toThrow()
  })

  test('invalidates both private views after a Primary Player transition', async () => {
    const invalidations: unknown[] = []
    const queryClient = {
      async invalidateQueries(options: unknown) {
        invalidations.push(options)
      },
    } as Parameters<typeof invalidatePlayerNavigation>[0]

    await invalidatePlayerNavigation(queryClient, 'account-one')

    expect(invalidations).toEqual([
      { queryKey: ['account', 'pinnedPlayers', 'account-one'] },
      { queryKey: ['account', 'playerShortcuts', 'account-one'] },
    ])
  })
})

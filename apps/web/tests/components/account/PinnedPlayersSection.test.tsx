import { describe, expect, test } from 'bun:test'
import type { PinnedPlayersContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { PinnedPlayersSection } from '../../../src/app/account/PinnedPlayersSection'
import { PinnedPlayerButton } from '../../../src/components/player/PlayerProfile/PinnedPlayerButton'

const pinnedPlayers: PinnedPlayersContract = [
  {
    brawlhallaId: 42,
    order: 0,
    pinnedAt: '2026-08-10T08:00:00Z',
    player: { brawlhallaId: 42, name: 'Ada', aliases: [] },
    currentSeason: {
      brawlhallaId: 42,
      checkedAt: '2026-08-10T10:30:00Z',
      lastSuccessAt: '2026-08-10T10:00:00Z',
      freshness: 'stale',
      freshForSeconds: 3_600,
      sparsePulse: {
        checkedAt: '2026-08-10T10:25:00Z',
        lastSuccessAt: '2026-08-10T10:20:00Z',
      },
      snapshot: {
        oneVsOne: {
          rating: 1_650,
          peakRating: 1_700,
          tier: 'Gold 5',
          wins: 6,
          games: 12,
          region: 'US-E',
          globalRank: null,
          regionRank: null,
        },
        rankedLegends: [],
        mainLegend: { legendId: 3, legendNameKey: 'bodvar', source: 'current-season' },
        fixedTeams: [],
        soloQueue: [],
        ratingHistory: [
          {
            rating: 1_600,
            peakRating: 1_650,
            tier: 'Gold 4',
            wins: 5,
            games: 10,
            source: 'v0-player-snapshot',
            recordedAt: '2026-08-10T09:00:00Z',
          },
          {
            rating: 1_650,
            peakRating: 1_700,
            tier: 'Gold 5',
            wins: 6,
            games: 12,
            source: 'v0-player-snapshot',
            recordedAt: '2026-08-10T10:00:00Z',
          },
        ],
        observedRatingDirection: {
          direction: 'up',
          ratingChange: 50,
          observationCount: 2,
          fromObservedAt: '2026-08-10T09:00:00Z',
          toObservedAt: '2026-08-10T10:00:00Z',
        },
      },
    },
  },
  {
    brawlhallaId: 43,
    order: 1,
    pinnedAt: '2026-08-10T09:00:00Z',
    player: null,
    currentSeason: {
      brawlhallaId: 43,
      checkedAt: '2026-08-10T10:30:00Z',
      lastSuccessAt: null,
      freshness: 'unavailable',
      freshForSeconds: 3_600,
      sparsePulse: null,
      snapshot: null,
    },
  },
]

const legacyPinnedPlayers: PinnedPlayersContract = Array.from({ length: 21 }, (_, index) => ({
  brawlhallaId: 100 + index,
  order: index,
  pinnedAt: `2026-08-${String(10 + (index % 10)).padStart(2, '0')}T08:00:00Z`,
  player: null,
  currentSeason: null,
}))

const twentyManagedPinsWithPrimary: PinnedPlayersContract = [
  ...legacyPinnedPlayers.slice(0, 20),
  { ...pinnedPlayers[0], order: 20, pinnedAt: '2026-08-30T08:00:00Z' },
]

const primaryBetweenManagedPins: PinnedPlayersContract = [
  { ...pinnedPlayers[1], order: 0 },
  { ...pinnedPlayers[0], order: 1 },
  { ...pinnedPlayers[1], brawlhallaId: 44, order: 2 },
]

describe('PinnedPlayersSection', () => {
  test('renders concise ranked card facts without explanatory copy', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={pinnedPlayers}
        loading={false}
        pendingPlayerId={null}
        primaryPlayerKnown
        primaryPlayerId={null}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).toContain('Pinned Players')
    expect(html).toContain('pinned-players-heading')
    expect(html).toContain('Player ID 43')
    expect(html).toContain('Unpin Ada')
    expect(html).toContain('Unpin Player ID 43')
    expect(html).not.toContain('Private pins visible only to you')
    expect(html).not.toContain('does not claim ownership or create a public follow')
    expect(html).not.toContain('Pinned order for')
    expect(html).not.toContain('Ranked observation details')
    expect(html).not.toContain('Sparse pulse last checked')
    expect(html).toContain('1650')
    expect(html).toContain('Gold 5')
    expect(html).toContain('6W / 6L')
    expect(html).toContain('Update delayed')
    expect(html).toContain('Up 50 rating')
    expect(html).toContain('2026-08-10')
    expect(html).toContain('Ranked observation unavailable')
    expect(html).not.toContain('shortcuts pinned')
    expect(html).not.toContain('Player 43</')
    expect(html).not.toContain('Follower')
  })

  test('distinguishes a failed private query from an empty collection', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={[]}
        loading={false}
        error
        pendingPlayerId={null}
        primaryPlayerKnown
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).toContain('Pinned Players are unavailable. Try again.')
    expect(html).not.toContain('No Pinned Players yet.')
  })

  for (const reason of ['loading', 'error'] as const) {
    test(`hides management controls while Primary Player query is ${reason}`, () => {
      const html = renderToStaticMarkup(
        <PinnedPlayersSection
          pinnedPlayers={legacyPinnedPlayers}
          loading={false}
          primaryPlayerKnown={false}
          pendingPlayerId={null}
          onUnpin={() => {}}
          onMove={() => {}}
        />,
      )

      expect(html).not.toContain('aria-label="Unpin Player ID 100"')
      expect(html).not.toContain('aria-label="Move Player ID 100 up in Pinned Players"')
      expect(html).not.toContain('new pins are limited to 20')
    })
  }

  test('uses one ordered list with explicit accessible names', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={pinnedPlayers}
        loading={false}
        primaryPlayerKnown
        pendingPlayerId={null}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).toContain('<ol')
    expect(html).toContain('aria-label="Unpin Ada"')
    expect(html).toContain('aria-label="Move Ada down in Pinned Players"')
    expect(html).toContain('aria-label="Move Player ID 43 up in Pinned Players"')
    expect(html).toContain('disabled=""')

    const pendingHtml = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={pinnedPlayers}
        loading={false}
        primaryPlayerKnown
        pendingPlayerId={42}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )
    expect(pendingHtml.match(/disabled=""/g)).toHaveLength(6)
  })

  test('allows managed pins to cross the retained Primary Player', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={primaryBetweenManagedPins}
        loading={false}
        primaryPlayerKnown
        primaryPlayerId={42}
        pendingPlayerId={null}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).not.toContain('aria-label="Move Player ID 43 down in Pinned Players" disabled=""')
    expect(html).not.toContain('aria-label="Move Player ID 44 up in Pinned Players" disabled=""')
  })

  test('marks a retained primary player as You without an unpin action', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={pinnedPlayers}
        loading={false}
        primaryPlayerKnown
        pendingPlayerId={null}
        primaryPlayerId={42}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).toContain('You')
    expect(html).not.toContain('aria-label="Unpin Ada"')
    expect(html).not.toContain('aria-label="Move Ada up in Pinned Players"')
    expect(html).not.toContain('aria-label="Move Ada down in Pinned Players"')
    expect(html).not.toContain('Pinned order for Ada')
    expect(html).toContain('aria-label="Unpin Player ID 43"')
  })

  test('does not count a retained primary row toward the managed pin cap', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={twentyManagedPinsWithPrimary}
        loading={false}
        primaryPlayerKnown
        pendingPlayerId={null}
        primaryPlayerId={42}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).not.toContain('new pins are limited to 20')
    expect(html).not.toContain('remove a player before pinning another')
    expect(html).toContain('You')
  })

  test('explains legacy pins above the current limit without hiding them', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={legacyPinnedPlayers}
        loading={false}
        primaryPlayerKnown
        pendingPlayerId={null}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).toContain('new pins are limited to 20')
    expect(html).toContain('remove a player before pinning another')
    expect(html).toContain('Player ID 120')
  })
})

describe('PinnedPlayerButton', () => {
  test('renders a borderless Pin or Unpin pressed toggle', () => {
    const pin = renderToStaticMarkup(<PinnedPlayerButton pinned={false} pending={false} onToggle={() => {}} />)
    const unpin = renderToStaticMarkup(<PinnedPlayerButton pinned pending={false} onToggle={() => {}} />)
    const pending = renderToStaticMarkup(<PinnedPlayerButton pinned={false} pending onToggle={() => {}} />)
    const limited = renderToStaticMarkup(
      <PinnedPlayerButton pinned={false} pending={false} disabled onToggle={() => {}} />,
    )

    expect(pin).toContain('>Pin<')
    expect(pin).toContain('aria-pressed="false"')
    expect(pin).not.toContain('border')
    expect(unpin).toContain('>Unpin<')
    expect(pending).toContain('>Pin<')
    expect(pending).toContain('aria-busy="true"')
    expect(pending).not.toContain('Updating Pinned Players')
    expect(limited).toContain('Pinned Players limit reached')
  })
})

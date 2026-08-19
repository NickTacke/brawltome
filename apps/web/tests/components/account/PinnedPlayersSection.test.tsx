import { describe, expect, test } from 'bun:test'
import type { PinnedPlayersContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { PinnedPlayersSection } from '../../../src/app/account/PinnedPlayersSection'
import { SavedPlayerButton } from '../../../src/components/player/PlayerProfile/SavedPlayerButton'

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

describe('PinnedPlayersSection', () => {
  test('labels private pins and discloses canonical observation coverage and freshness', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={pinnedPlayers}
        loading={false}
        pendingPlayerId={null}
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
    expect(html).toContain('Private pins visible only to you')
    expect(html).toContain('does not claim ownership or create a public follow')
    expect(html).toContain('Current Season')
    expect(html).toContain('Update delayed')
    expect(html).toContain('Latest supported 1v1 rating: 1650')
    expect(html).toContain('Ranked observation details')
    expect(html).toContain('<details')
    expect(html).toContain('Sparse pulse last checked')
    expect(html).toContain('latest supported rating may be newer than the complete ranked observation')
    expect(html).toContain('do not update rank, tier, region, legends, Solo Queue, team composition, or rating history')
    expect(html).toContain('BrawlTome-observed direction')
    expect(html).toContain('Up 50 rating across 2 observations')
    expect(html).toContain('2026-08-10 to 2026-08-10')
    expect(html).toContain('up to 365 retained BrawlTome complete-ranked observations')
    expect(html).toContain('latest monotonic-games segment')
    expect(html).toContain('Sparse pulse overlays are excluded')
    expect(html).toContain('This is BrawlTome coverage, not complete Elo history')
    expect(html).toContain('Current Season ranked facts unavailable')
    expect(html).not.toContain('Saved Players')
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
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).toContain('Pinned Players are unavailable. Try again.')
    expect(html).not.toContain('No Pinned Players yet.')
  })

  test('uses one ordered list with explicit accessible names', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={pinnedPlayers}
        loading={false}
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
        pendingPlayerId={42}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )
    expect(pendingHtml.match(/disabled=""/g)).toHaveLength(6)
  })

  test('marks a retained primary player as You without an unpin action', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={pinnedPlayers}
        loading={false}
        pendingPlayerId={null}
        primaryPlayerId={42}
        onUnpin={() => {}}
        onMove={() => {}}
      />,
    )

    expect(html).toContain('You')
    expect(html).not.toContain('aria-label="Unpin Ada"')
    expect(html).toContain('aria-label="Unpin Player ID 43"')
  })

  test('explains legacy pins above the current limit without hiding them', () => {
    const html = renderToStaticMarkup(
      <PinnedPlayersSection
        pinnedPlayers={legacyPinnedPlayers}
        loading={false}
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

describe('SavedPlayerButton', () => {
  test('exposes save state as an accessible toggle', () => {
    const save = renderToStaticMarkup(<SavedPlayerButton saved={false} pending={false} onToggle={() => {}} />)
    const remove = renderToStaticMarkup(<SavedPlayerButton saved pending={false} onToggle={() => {}} />)
    const limited = renderToStaticMarkup(
      <SavedPlayerButton saved={false} pending={false} disabled onToggle={() => {}} />,
    )

    expect(save).toContain('aria-pressed="false"')
    expect(save).toContain('aria-busy="false"')
    expect(save).toContain('Save player')
    expect(remove).toContain('aria-pressed="true"')
    expect(remove).toContain('Remove from Saved Players')
    expect(limited).toContain('disabled=""')
    expect(limited).toContain('Saved Players limit reached')
  })
})

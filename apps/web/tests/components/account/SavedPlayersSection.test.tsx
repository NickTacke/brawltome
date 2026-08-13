import { describe, expect, test } from 'bun:test'
import type { SavedPlayersContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { SavedPlayersSection } from '../../../src/app/account/SavedPlayersSection'
import { SavedPlayerButton } from '../../../src/components/player/PlayerProfile/SavedPlayerButton'

const savedPlayers: SavedPlayersContract = [
  {
    brawlhallaId: 42,
    order: 0,
    pinOrder: 0,
    savedAt: '2026-08-10T08:00:00Z',
    player: { brawlhallaId: 42, name: 'Ada' },
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
    pinOrder: null,
    savedAt: '2026-08-10T09:00:00Z',
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

describe('SavedPlayersSection', () => {
  test('labels private bookmarks and discloses canonical observation coverage and freshness', () => {
    const html = renderToStaticMarkup(
      <SavedPlayersSection
        savedPlayers={savedPlayers}
        loading={false}
        pendingPlayerId={null}
        onRemove={() => {}}
        onMove={() => {}}
        onTogglePin={() => {}}
        onMovePin={() => {}}
      />,
    )

    expect(html).toContain('Saved Players')
    expect(html).toContain('Private bookmarks visible only to you')
    expect(html).toContain('does not claim ownership or create a public follow')
    expect(html).toContain('Current Season')
    expect(html).toContain('Update delayed')
    expect(html).toContain('Latest supported 1v1 rating: 1650')
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
    expect(html).not.toContain('Player 43</')
    expect(html).not.toContain('live')
    expect(html).not.toContain('Follower')
  })

  test('distinguishes a failed private query from an empty collection', () => {
    const html = renderToStaticMarkup(
      <SavedPlayersSection
        savedPlayers={[]}
        loading={false}
        error
        pendingPlayerId={null}
        onRemove={() => {}}
        onMove={() => {}}
        onTogglePin={() => {}}
        onMovePin={() => {}}
      />,
    )

    expect(html).toContain('Saved Players are unavailable. Try again.')
    expect(html).not.toContain('No Saved Players yet.')
  })

  test('uses semantic list controls with explicit accessible names', () => {
    const html = renderToStaticMarkup(
      <SavedPlayersSection
        savedPlayers={savedPlayers}
        loading={false}
        pendingPlayerId={null}
        onRemove={() => {}}
        onMove={() => {}}
        onTogglePin={() => {}}
        onMovePin={() => {}}
      />,
    )

    expect(html).toContain('<ol')
    expect(html).toContain('aria-label="Unpin Ada from shortcuts"')
    expect(html).toContain('aria-label="Move Ada down in pinned shortcuts"')
    expect(html).toContain('aria-label="Move Ada down in Saved Players"')
    expect(html).toContain('aria-label="Remove Ada from Saved Players"')
    expect(html).toContain('aria-label="Pin Player ID 43 to shortcuts"')
    expect(html).toContain('aria-label="Move Player ID 43 up in Saved Players"')
    expect(html).toContain('disabled=""')

    const pendingHtml = renderToStaticMarkup(
      <SavedPlayersSection
        savedPlayers={savedPlayers}
        loading={false}
        pendingPlayerId={42}
        onRemove={() => {}}
        onMove={() => {}}
        onTogglePin={() => {}}
        onMovePin={() => {}}
      />,
    )
    expect(pendingHtml.match(/disabled=""/g)).toHaveLength(10)
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

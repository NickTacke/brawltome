import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RankedCard } from '../../../src/components/player/RankedCard'

const availablePlayer = {
  rating: 1_600,
  peakRating: 1_650,
  tier: 'Gold 4',
  rankedGames: 10,
  rankedWins: 6,
  rankedLastUpdated: '2026-08-10T10:00:00Z',
}

describe('RankedCard', () => {
  test('keeps the V2 ranked summary when current-season data is available', () => {
    const html = renderToStaticMarkup(<RankedCard player={availablePlayer} rankedTeams={[]} />)

    expect(html).toContain('Ranked Performance')
    expect(html).toContain('Gold 4')
    expect(html).toContain('1600')
    expect(html).toContain('1650')
    expect(html).toContain('6W')
    expect(html).toContain('4L')
    expect(html).toContain('Ranked Games')
    expect(html).toContain('Total Glory')
    expect(html).toContain('Elo Reset')
    expect(html).toContain('Updated')
  })

  test('renders the provider unranked sentinel with the V2 Unranked presentation', () => {
    const html = renderToStaticMarkup(
      <RankedCard
        player={{
          ...availablePlayer,
          rating: 0,
          peakRating: 0,
          tier: 'none',
          rankedGames: 0,
          rankedWins: 0,
        }}
        rankedTeams={[]}
      />,
    )

    expect(html).toContain('/images/banners/Unranked.png')
    expect(html).toContain('alt="Unranked"')
    expect(html).toContain('>Unranked<')
    expect(html).not.toContain('>none<')
  })

  test('shows unavailable current-season data as plain Unranked', () => {
    const html = renderToStaticMarkup(
      <RankedCard
        player={{
          ...availablePlayer,
          legacyRating: 1_800,
          rating: null,
          peakRating: null,
          tier: null,
          rankedGames: undefined,
          rankedWins: undefined,
          rankedLastUpdated: null,
        }}
        rankedTeams={[]}
      />,
    )

    expect(html).toContain('Unranked')
    expect(html).not.toContain('V2 snapshot')
    expect(html).not.toContain('1800')
    expect(html).not.toContain('Rating unavailable')
    expect(html).not.toContain('Current-season wins and losses are unavailable')
    expect(html).not.toContain('Ranked Games')
    expect(html).not.toContain('Total Glory')
    expect(html).not.toContain('Elo Reset')
    expect(html).not.toContain('Updated')
  })
})

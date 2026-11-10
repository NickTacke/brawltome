import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Ranked } from '../src/components/player/Ranked'
import type { OneVsOne } from '../src/components/player/side-summary'

const unplaced: OneVsOne = {
  rating: 2_412,
  peakRating: 2_450,
  tier: 'Diamond',
  wins: 500,
  games: 905,
  region: 'EU',
  globalRank: null,
  regionRank: null,
}

// the text of the page without its tags, so a rank and its board read as one phrase
function textOf(standing?: OneVsOne): string {
  const html = renderToStaticMarkup(<Ranked standing={standing} />)

  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

describe('Ranked 1v1 placement', () => {
  test('shows the place in the region and in the world', () => {
    const text = textOf({ ...unplaced, regionRank: 61, globalRank: 184 })

    expect(text).toContain('#61 EU')
    expect(text).toContain('#184 Global')
    expect(text.indexOf('#61 EU')).toBeLessThan(text.indexOf('#184 Global'))
  })

  test('groups the digits of a place past a thousand', () => {
    expect(textOf({ ...unplaced, regionRank: 1_000, globalRank: null })).toContain('#1,000 EU')
  })

  test('shows the regional place alone for a player who is not on the global board', () => {
    const text = textOf({ ...unplaced, regionRank: 61 })

    expect(text).toContain('#61 EU')
    expect(text).not.toContain('Global')
  })

  test('shows the global place alone for a player who is not on the board of their region', () => {
    const text = textOf({ ...unplaced, globalRank: 184 })

    expect(text).toContain('#184 Global')
    expect(text).not.toContain('EU')
  })

  test('shows the global place alone when the profile has no region', () => {
    const text = textOf({ ...unplaced, region: null, regionRank: 61, globalRank: 184 })

    expect(text).toContain('#184 Global')
    expect(text).not.toContain('#61')
  })

  test('shows no place for a player on neither board', () => {
    const text = textOf(unplaced)

    expect(text).toContain('Diamond')
    expect(text).not.toContain('#')
  })

  test('shows no place for a player without games this season', () => {
    expect(textOf({ ...unplaced, games: 0, wins: 0, regionRank: 61, globalRank: 184 })).not.toContain('#')
  })

  test('shows no place for a player without ranked data', () => {
    expect(textOf()).not.toContain('#')
  })
})

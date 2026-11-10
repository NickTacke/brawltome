import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LegendsRow } from '../src/components/home/LegendsRow'

describe('Home legends row', () => {
  test('shows each most played legend with its share of games', () => {
    const html = renderToStaticMarkup(
      <LegendsRow mostPlayed={[{ legendNameKey: 'redraptor', games: 120, share: 0.0489 }]} />,
    )

    expect(html).toContain('Most played legends')
    expect(html).toContain('/images/legends/avatars/redraptor.png')
    expect(html).toContain('Red Raptor')
    expect(html).toContain('4.9%')
  })

  test('a legend the site has no art for gets the silhouette', () => {
    const html = renderToStaticMarkup(
      <LegendsRow mostPlayed={[{ legendNameKey: 'new legend', games: 5, share: 0.01 }]} />,
    )

    expect(html).toContain('/images/legends/random.svg')
    expect(html).toContain('New Legend')
  })

  test('hides the whole row without legends, so no empty band is left between the dividers', () => {
    expect(renderToStaticMarkup(<LegendsRow mostPlayed={[]} />)).toBe('')
  })
})

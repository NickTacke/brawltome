import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LegendsRow } from '../src/components/home/LegendsRow'

const redraptor = { legendNameKey: 'redraptor', games: 120, share: 0.0489 }
const diana = { legendNameKey: 'diana', games: 14_250, playerCount: 138, winRate: 0.5612 }

describe('Home legends row', () => {
  test('shows each most played legend with its share of games', () => {
    const html = renderToStaticMarkup(<LegendsRow mostPlayed={[redraptor]} meta={[]} />)

    expect(html).toContain('Most played legends')
    expect(html).toContain('/images/legends/avatars/redraptor.png')
    expect(html).toContain('Red Raptor')
    expect(html).toContain('4.9%')
  })

  test('a legend the site has no art for gets the silhouette', () => {
    const html = renderToStaticMarkup(
      <LegendsRow mostPlayed={[{ legendNameKey: 'new legend', games: 5, share: 0.01 }]} meta={[]} />,
    )

    expect(html).toContain('/images/legends/random.svg')
    expect(html).toContain('New Legend')
  })

  test('shows each meta legend with its games, high rated players and win rate', () => {
    const html = renderToStaticMarkup(<LegendsRow mostPlayed={[]} meta={[diana]} />)

    expect(html).toContain('Meta legends')
    expect(html).toContain('Most played by players rated 2000+ this season')
    expect(html).toContain('/images/legends/avatars/diana.png')
    expect(html).toContain('Diana')
    expect(html).toContain('14,250')
    expect(html).toContain('138')
    expect(html).toContain('text-win">56.1%')
  })

  test('puts most played on the left and meta on the right, with a line between them', () => {
    const html = renderToStaticMarkup(<LegendsRow mostPlayed={[redraptor]} meta={[diana]} />)

    expect(html).toContain('xl:grid-cols-2')
    expect(html).toContain('xl:divide-x')
    expect(html.indexOf('Most played legends')).toBeLessThan(html.indexOf('Meta legends'))
  })

  test('without most played, meta keeps the right half alone', () => {
    const html = renderToStaticMarkup(<LegendsRow mostPlayed={[]} meta={[diana]} />)

    expect(html).not.toContain('Most played legends')
    expect(html).toContain('xl:grid-cols-2')
    expect(html).toContain('xl:col-start-2')
    // the line that separates the two when stacked has nothing to separate
    expect(html).not.toContain('border-t')
  })

  test('without meta, most played keeps the left half alone', () => {
    const html = renderToStaticMarkup(<LegendsRow mostPlayed={[redraptor]} meta={[]} />)

    expect(html).not.toContain('Meta legends')
    expect(html).toContain('xl:grid-cols-2')
    expect(html).not.toContain('xl:col-start-2')
  })

  test('hides the whole row without legends, so no empty band is left between the dividers', () => {
    expect(renderToStaticMarkup(<LegendsRow mostPlayed={[]} meta={[]} />)).toBe('')
  })
})

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PostMatchCard } from '../ui/overlay/PostMatchCard'
import { type PostMatchView, signedChange } from '../ui/overlay/post-match'

const won: PostMatchView = {
  isWin: true,
  opponents: [{ brawlhallaId: 91913839, name: 'Shinigami', legend: 'Hattori' }],
  tier: 'Diamond',
  tierChange: null,
  rating: 2130,
  ratingChange: 18,
  personal2v2: null,
  matchPage: null,
}

function render(match: PostMatchView): string {
  return renderToStaticMarkup(<PostMatchCard match={match} onOpenMatchPage={() => {}} />)
}

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

describe('post-match card', () => {
  test('a win shows the result, the opponent and the new elo with its change', () => {
    const html = render(won)

    expect(textOf(html)).toBe('WonvsShinigami2130+18Elo')
    expect(html).toContain('class="result won"')
    expect(html).toContain('src="/banners/Diamond.png"')
  })

  test('a loss is red and its change has a minus sign', () => {
    const html = render({ ...won, isWin: false, ratingChange: -16 })

    expect(html).toContain('class="result lost"')
    expect(html).toContain('class="change down"')
    expect(signedChange(-16)).toBe('−16')
  })

  test('a new tier is the second figure', () => {
    const html = render({ ...won, tierChange: 'up' })

    expect(textOf(html)).toContain('DiamondUp a tier')
  })

  test('a 2v2 names both opponents and shows your own 2v2 elo', () => {
    const koa = { brawlhallaId: 7781120, name: 'Koa', legend: 'Ada' }
    const html = render({ ...won, opponents: [...won.opponents, koa], personal2v2: { rating: 2190, change: 9 } })

    expect(textOf(html)).toContain('Shinigami + Koa')
    expect(textOf(html)).toContain('Team Elo2190+9Your 2v2 Elo')
  })

  test('the card only opens the match page once it is ready', () => {
    expect(render(won)).not.toContain('match-row')
    expect(render({ ...won, matchPage: 'uploading' })).toContain('<div class="card post-match">')
    expect(textOf(render({ ...won, matchPage: 'uploading' }))).toContain('Uploading replay')

    const ready = render({ ...won, matchPage: 'ready' })

    expect(ready).toContain('<button type="button" class="card post-match">')
    expect(textOf(ready)).toContain('Match page→')
  })
})

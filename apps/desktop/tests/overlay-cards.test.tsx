import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { type BannerSide, Overlay } from '../ui/overlay/Overlay'
import type { CardData, Known, OverlayView } from '../ui/overlay/overlay-view'
import { SoloCard } from '../ui/overlay/SoloCard'

function fixture(name: string): OverlayView {
  const file = path.join(import.meta.dir, 'fixtures', `overlay-view-${name}.json`)

  return JSON.parse(readFileSync(file, 'utf8'))
}

function render(view: OverlayView, bannerSide: BannerSide = 'left'): string {
  const ignore = () => {}

  return renderToStaticMarkup(
    <Overlay
      view={view}
      monitorHeightPx={1080}
      bannerSide={bannerSide}
      onOpenProfile={ignore}
      onRetry={ignore}
      onResize={ignore}
    />,
  )
}

// the markup of the first element carrying the class, so a test can read one part of a card
function partOf(html: string, className: string): string {
  const start = html.search(new RegExp(`<[a-z]+[^>]*? class="([^"]* )?${className}( [^"]*)?"`))

  if (start === -1) return ''

  const tags = /<(\/?)[a-z]+[^>]*?(\/?)>/g
  let depth = 0

  tags.lastIndex = start

  for (let match = tags.exec(html); match !== null; match = tags.exec(html)) {
    const isClosing = match[1] === '/'
    const isSelfClosing = match[2] === '/' || match[0].startsWith('<img')

    if (isSelfClosing) continue

    depth += isClosing ? -1 : 1

    if (depth === 0) return html.slice(start, match.index + match[0].length)
  }

  return ''
}

type ElementProps = { className?: string; children?: ReactNode; onClick?: () => void }

// walks the elements a component returned, without rendering, to reach a handler
function elementWithClass(node: ReactNode, className: string): ElementProps | null {
  if (Array.isArray(node)) {
    return node.map((child) => elementWithClass(child, className)).find((found) => found !== null) ?? null
  }

  if (typeof node !== 'object' || node === null || !('props' in node)) return null

  const props = node.props as ElementProps

  if (props.className === className) return props

  return elementWithClass(props.children, className)
}

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function withSoloData(view: OverlayView, data: CardData): OverlayView {
  const [card] = view.cards

  if (card?.kind !== 'solo') throw new Error('expected a solo card in the fixture')

  return { ...view, cards: [{ ...card, data }] }
}

function withSoloName(view: OverlayView, name: string): OverlayView {
  const [card] = view.cards

  if (card?.kind !== 'solo') throw new Error('expected a solo card in the fixture')

  return { ...view, cards: [{ ...card, player: { ...card.player, name } }] }
}

// a player the game's memory holds nothing about, like one in another playlist's first match
function withoutMemory(view: OverlayView): OverlayView {
  const [card] = view.cards

  if (card?.kind !== 'solo') throw new Error('expected a solo card in the fixture')

  return { ...view, cards: [{ ...card, known: null }] }
}

function withKnown(view: OverlayView, known: Known): OverlayView {
  const [card] = view.cards

  if (card?.kind !== 'solo') throw new Error('expected a solo card in the fixture')

  return { ...view, cards: [{ ...card, known }] }
}

describe('cards from memory', () => {
  test('a card shows the Elo, base tier and games before the lookup answers, without a spinner', () => {
    const html = render(fixture('solo-loading'))

    expect(textOf(partOf(html, 'sub'))).toBe('Diamond')
    expect(html).toContain('src="/banners/Diamond.png"')
    expect(textOf(partOf(html, 'figures'))).toBe('2130Elo / peak1,204 games')
    expect(html).toContain('peak-bar')
    expect(html).not.toContain('class="spinner"')
  })

  test('a failed lookup keeps the memory figures and says why where the win rate goes', () => {
    const html = render(fixture('solo-failed'))

    expect(textOf(partOf(html, 'figures'))).toBe('2130Elo—BrawlTome is down')
    expect(html).not.toContain('Retry')
  })

  test('a player in placement shows how far, and no banner', () => {
    const html = render(withKnown(fixture('solo-loading'), { rating: 1186, games: 3 }))

    expect(textOf(partOf(html, 'sub'))).toBe('Placement 3/10')
    expect(html).toContain('banner-empty')
  })

  test('the Elo from memory wins over an older one from the lookup', () => {
    const html = render(withKnown(fixture('solo-ranked'), { rating: 2141, games: 1205 }))

    expect(textOf(partOf(html, 'figures'))).toContain('2141/ 2204')
  })

  test('a random teammate gets a card under the opponents', () => {
    const team = fixture('team')
    const view: OverlayView = {
      ...team,
      cards: [
        ...team.cards,
        {
          kind: 'teammate',
          player: { brawlhallaId: 7, name: 'Fox', legend: 'Ember' },
          known: { rating: 1987, games: 117 },
        },
      ],
    }

    const html = render(view)

    expect(textOf(partOf(html, 'teammate-card'))).toBe('FoxYour teammate·Platinum1987Their 2v2 Elo117games')
  })
})

describe('overlay cards', () => {
  test('a ranked card shows tier, rank, Elo, peak, win rate and games, and no region', () => {
    const html = render(fixture('solo-ranked'))

    expect(textOf(partOf(html, 'name'))).toBe('Shinigami')
    expect(textOf(partOf(html, 'sub'))).toBe('Diamond·#48')
    expect(html).toContain('src="/banners/Diamond.png"')
    expect(html).toContain('src="/legends/hattori.png"')
    expect(textOf(partOf(html, 'figures'))).toBe('2130/ 2204Elo / peak61%1,204 games')
    expect(html).toContain('class="stat-value rate rate-high"')
    expect(html).not.toContain('class="spinner"')
  })

  test('a card with stored data that is refreshing shows the spinner', () => {
    const html = render(fixture('solo-refreshing'))

    expect(textOf(partOf(html, 'sub'))).toBe('Diamond·#48')
    expect(html).toContain('class="spinner"')
    expect(html).toContain('is-refreshing')
    expect(textOf(partOf(html, 'figures'))).toContain('2130')
  })

  test('an unknown player reads No ranked data and has no figures', () => {
    const html = render(withoutMemory(fixture('solo-no-data')))

    expect(textOf(partOf(html, 'sub'))).toBe('No ranked data')
    expect(html).not.toContain('figures')
    expect(html).not.toContain('/banners/')
  })

  test('a failed card says why and when it tries again', () => {
    const html = render(withoutMemory(fixture('solo-failed')))

    expect(textOf(partOf(html, 'sub'))).toBe('BrawlTome is down')
    expect(textOf(partOf(html, 'note'))).toBe('Try again in 4s')
    expect(textOf(partOf(html, 'text-button'))).toBe('Retry')
  })

  test('a failed card still opens the profile from its head', () => {
    const view = withoutMemory(fixture('solo-failed'))
    const [card] = view.cards

    if (card?.kind !== 'solo') throw new Error('expected a solo card in the fixture')

    const opened: number[] = []
    const ignore = () => {}

    const failedCard = SoloCard({
      player: card.player,
      known: null,
      data: card.data,
      onOpenProfile: (brawlhallaId) => opened.push(brawlhallaId),
      onRetry: ignore,
    })

    const html = render(view)

    elementWithClass(failedCard, 'card-link')?.onClick?.()

    expect(opened).toEqual([91913839])
    expect(textOf(partOf(html, 'card-link'))).toBe('ShinigamiBrawlTome is down')
    expect(partOf(html, 'card-link')).not.toContain('Retry')
  })

  test('a failed card without a retry has no retry row', () => {
    const failed: CardData = { state: 'failed', reason: 'updateRequired', retryInSeconds: null, canRetry: false }
    const html = render(withSoloData(withoutMemory(fixture('solo-failed')), failed))

    expect(textOf(partOf(html, 'sub'))).toBe('Update BrawlTome')
    expect(html).not.toContain('plain-row')
  })

  test('a loading card without memory data shows the name and legend', () => {
    const html = render(withoutMemory(fixture('solo-loading')))

    expect(textOf(partOf(html, 'name'))).toBe('Shinigami')
    expect(html).toContain('src="/legends/hattori.png"')
    expect(partOf(html, 'figures')).toContain('placeholder')
    expect(html).toContain('banner-empty')
    expect(html).toContain('class="spinner"')
    expect(textOf(partOf(html, 'figures'))).toBe('')
  })

  test('a team card shows the team Elo and each personal 2v2 Elo with its tier', () => {
    const html = render(fixture('team'))

    expect(textOf(partOf(html, 'team-figures'))).toBe('2284/ 2301Team Elo / peak57%90 games')
    expect(partOf(html, 'banner-slot')).toContain('src="/banners/Diamond.png"')
    expect(textOf(partOf(html, 'players'))).toBe('ShinigamiDiamond·2190tidecallerDiamond·2075')
    expect(html).toContain('src="/legends/petra.png"')
    expect(html).not.toContain('1v1')
  })

  test('a new duo without a stored team rating shows the average personal 2v2 elo and its tier', () => {
    const view = fixture('team')
    const [card] = view.cards

    if (card?.kind !== 'team') throw new Error('expected a team card in the fixture')

    const html = render({
      ...view,
      cards: [{ ...card, data: { state: 'ready', standing: null, isRefreshing: false } }],
    })

    expect(textOf(partOf(html, 'team-figures'))).toBe('2133Team avg')
    expect(partOf(html, 'banner-slot')).toContain('src="/banners/Diamond.png"')
  })

  test('a team card without memory ratings falls back to 1v1 Elo, then to nothing', () => {
    const html = render(fixture('team-bare'))

    expect(textOf(partOf(html, 'team-figures'))).toBe('—2v2 team')
    expect(html).not.toContain('/banners/')
    expect(textOf(partOf(html, 'players'))).toBe('Shinigami1v1·2130tidecaller')
  })

  test('a known player with no games this season shows zeros, not No ranked data', () => {
    const ranked = withoutMemory(fixture('solo-ranked'))

    const zeroGames: CardData = {
      state: 'ranked',
      tier: 'Tin 0',
      rating: 782,
      peakRating: 782,
      regionRank: null,
      wins: 0,
      games: 0,
      isRefreshing: false,
    }

    const html = render(withSoloData(ranked, zeroGames))

    expect(textOf(partOf(html, 'sub'))).toBe('Tin 0')
    expect(textOf(partOf(html, 'figures'))).toBe('782/ 782Elo / peak—0 games')
    expect(html).not.toContain('No ranked data')
  })

  test('a name with markup is text, and a long name does not widen the card', () => {
    const markup = render(withSoloName(fixture('solo-ranked'), '<img src=x onerror=alert(1)>'))
    const long = render(withSoloName(fixture('solo-ranked'), 'W'.repeat(60)))
    const css = readFileSync(path.join(import.meta.dir, '../ui/overlay/overlay.css'), 'utf8')
    const nameStart = css.indexOf('\n.name {')
    const nameRule = css.slice(nameStart, css.indexOf('}', nameStart))

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img src=x')
    expect(partOf(long, 'name')).toStartWith('<span class="name">')
    expect(nameRule).toContain('text-overflow: ellipsis')
    expect(nameRule).toContain('white-space: nowrap')
    expect(nameRule).toContain('overflow: hidden')
  })

  test('a player without a known legend gets the ? portrait', () => {
    const view = fixture('solo-ranked')
    const [card] = view.cards

    if (card?.kind !== 'solo') throw new Error('expected a solo card in the fixture')

    const html = render({ ...view, cards: [{ ...card, player: { ...card.player, legend: null } }] })

    expect(textOf(partOf(html, 'unknown'))).toBe('?')
    expect(html).not.toContain('/legends/')
  })

  test('the cards say which side the banner hangs on', () => {
    expect(render(fixture('solo-ranked'))).toContain('data-banner-side="left"')
    expect(render(fixture('solo-ranked'), 'right')).toContain('data-banner-side="right"')
  })

  test('the cards have no shadow or blur, and the page is see-through', () => {
    const css = readFileSync(path.join(import.meta.dir, '../ui/overlay/overlay.css'), 'utf8')

    expect(css).not.toContain('box-shadow')
    expect(css).not.toContain('backdrop-filter')
    expect(css).not.toContain('is-hover')
    expect(css).toMatch(/html,\s*body\s*{[^}]*background: transparent/)
  })
})

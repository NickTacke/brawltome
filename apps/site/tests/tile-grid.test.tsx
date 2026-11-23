import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { legendWeapons } from '@brawltome/contracts/legend-weapons'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LegendRoster } from '../src/components/player/LegendRoster'
import { TileGrid } from '../src/components/player/TileGrid'
import type { CareerLegend } from '../src/components/player/weapon-stats'

const [legendId] = [...legendWeapons.keys()] as [number]

// longer than the card's show delay
const hoverWaitMs = 200

const legend = {
  legendId,
  legendNameKey: 'bodvar',
  level: 20,
  xp: 1000,
  games: 10,
  wins: 6,
  matchTime: 1000,
  kos: 5,
  falls: 2,
  weaponOne: { heldTime: 300, damage: '100', kos: 3 },
  weaponTwo: { heldTime: 200, damage: '50', kos: 1 },
  unarmed: { damage: '10', kos: 1 },
} as unknown as CareerLegend

type Item = { id: string; isOpenable: boolean }

const items: Item[] = [
  { id: 'a', isOpenable: true },
  { id: 'b', isOpenable: false },
]

function grid(props: { isCardHintShown?: boolean } = {}) {
  return (
    <TileGrid
      items={items}
      keyOf={(item) => item.id}
      labelOf={(item) => `tile ${item.id}`}
      canOpen={(item) => item.isOpenable}
      renderTile={(item) => <span>{item.id}</span>}
      renderCard={(item) => <span>card {item.id}</span>}
      renderDetail={(item) => <span>detail {item.id}</span>}
      {...props}
    />
  )
}

describe('tile grid', () => {
  let root: Root
  let container: HTMLElement

  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function mount(element: ReactNode) {
    await act(async () => root.render(element))
  }

  function tile(label: string): HTMLElement {
    const found = container.querySelector(`[aria-label="${label}"]`)

    if (!(found instanceof HTMLElement)) throw new Error(`no tile labelled ${label}`)

    return found
  }

  async function hover(element: HTMLElement) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, hoverWaitMs))
    })
  }

  const hoverCard = () => container.querySelector('[data-tile-card]')

  test('an open tile shows no hover card', async () => {
    await mount(grid())

    await act(async () => tile('tile a').click())
    await hover(tile('tile a'))

    expect(container.querySelector('[data-tile-detail]')?.textContent).toBe('detail a')
    expect(hoverCard() === null).toBe(true)
  })

  test('a closed tile still shows its hover card', async () => {
    await mount(grid())

    await hover(tile('tile a'))

    expect(hoverCard()?.textContent).toContain('card a')
  })

  test('a tile that cannot open stays closed when clicked', async () => {
    await mount(grid())

    await act(async () => tile('tile b').click())

    expect(container.querySelector('[data-tile-detail]') === null).toBe(true)
    expect(tile('tile b').hasAttribute('aria-expanded')).toBe(false)
  })

  test('a grid can leave the card hint out', async () => {
    await mount(grid({ isCardHintShown: false }))

    await hover(tile('tile a'))

    expect(hoverCard()?.textContent).not.toContain('Click for extended stats')
  })

  test('legend tiles still show the card hint', async () => {
    await mount(<LegendRoster legends={[legend]} rankedLegends={[]} />)

    await hover(tile('bodvar'))

    expect(hoverCard()?.textContent).toContain('Click for extended stats')
  })
})

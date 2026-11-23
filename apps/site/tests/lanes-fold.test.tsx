import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StageDeck } from '../src/components/match/stage/StageDeck'
import { lanesFoldStorageKey, useLanesFold } from '../src/components/match/stage/use-lanes-fold'

const ignore = () => undefined
const pageScreen = { isOn: false, isOverlay: false, exit: ignore, toggle: ignore }

let root: Root
let container: HTMLElement

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
})

async function mount(element: ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await act(async () => root.render(element))
}

function find(selector: string): HTMLElement {
  const element = container.querySelector(selector)

  if (!(element instanceof HTMLElement)) throw new Error(`find ${selector}: not on the page`)

  return element
}

async function click(selector: string): Promise<void> {
  await act(async () => find(selector).click())
}

const shownControls = {
  isShown: true,
  isHeld: false,
  wake: ignore,
  stage: {
    onPointerMove: ignore,
    onPointerDown: ignore,
    onPointerUp: ignore,
    onPointerCancel: ignore,
    onPointerLeave: ignore,
    onClick: ignore,
  },
  bar: { onPointerEnter: ignore, onPointerLeave: ignore },
}

// the deck with the fold the page keeps, and a timeline that says which one it is
function FoldingDeck() {
  const fold = useLanesFold()

  return (
    <StageDeck
      controls={shownControls}
      fullscreen={pageScreen}
      lanes={{ edge: 'bottom' }}
      fold={fold}
      transport={<span data-transport-buttons />}
      timeline={() => <span data-timeline>{fold.isFolded ? 'thin bar' : 'lanes'}</span>}
      speed={null}
      tools={null}
      note={null}
    />
  )
}

function timelineText(): string {
  return find('[data-stage-controls] [data-timeline]').textContent ?? ''
}

describe('folding the lanes', () => {
  test('the button folds the lanes into a thin bar that holds the transport, and back', async () => {
    await mount(<FoldingDeck />)

    expect(timelineText()).toBe('lanes')
    expect(find('[data-transport-buttons]').closest('[data-stage-controls]')).toBeNull()

    await click('[aria-label="Hide timeline"]')

    expect(timelineText()).toBe('thin bar')
    expect(find('[data-stage-controls]').dataset.folded).toBe('true')
    expect(find('[data-transport-buttons]').closest('[data-stage-controls]')).not.toBeNull()
    expect(find('[aria-label="Show timeline"] [data-tooltip]').textContent).toBe('Show timeline (T)')

    await click('[aria-label="Show timeline"]')

    expect(timelineText()).toBe('lanes')
  })

  test('the choice is kept for the next match', async () => {
    await mount(<FoldingDeck />)
    await click('[aria-label="Hide timeline"]')

    expect(window.localStorage.getItem(lanesFoldStorageKey)).toBe('folded')

    await act(async () => root.unmount())
    await mount(<FoldingDeck />)

    expect(timelineText()).toBe('thin bar')

    await click('[aria-label="Show timeline"]')

    expect(window.localStorage.getItem(lanesFoldStorageKey)).toBeNull()
  })

  test('without storage the lanes start unfolded and still fold for the page', async () => {
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage')

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage is blocked', 'SecurityError')
      },
    })

    try {
      await mount(<FoldingDeck />)

      expect(timelineText()).toBe('lanes')

      await click('[aria-label="Hide timeline"]')

      expect(timelineText()).toBe('thin bar')
    } finally {
      if (storage) Object.defineProperty(window, 'localStorage', storage)
    }
  })
})

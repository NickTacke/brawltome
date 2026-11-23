import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { usePanelPlace } from '../src/components/match/review/use-panel-place'
import type { Pose } from '../src/components/match/stage/pose'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

// a player standing low on the stage, where the lanes along the bottom would lie on them
const lowPlayer = { slot: 1, x: 0.5, y: 0.92, isInPlay: true } as Pose
const players = [lowPlayer]

// the dom lays nothing out, so the panel says how big it and the stage are: the lanes of a 1v1 on a laptop's stage
function laidOut(panel: HTMLDivElement) {
  const stage = { clientWidth: 780, clientHeight: 440 }

  Object.defineProperty(panel, 'offsetParent', { configurable: true, get: () => stage })
  Object.defineProperty(panel, 'offsetWidth', { configurable: true, get: () => 700 })
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => 66 })
}

// the lanes at a review's stop, which say the edge they lie along
function LanesAtStop({ isBottomOnly }: { isBottomOnly: boolean }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const place = usePanelPlace(panelRef, { key: 'punish-1', players, isBottomOnly }, false)

  function attach(panel: HTMLDivElement | null) {
    if (panel) laidOut(panel)

    panelRef.current = panel
  }

  return <div ref={attach} data-edge={place.edge} />
}

describe('the edge of the lanes at a stop', () => {
  test('is decided again once the bottom is no longer the only edge, as when the lanes unfold', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    document.body.append(container)

    await act(async () => root.render(<LanesAtStop isBottomOnly />))

    const edge = () => container.querySelector<HTMLElement>('[data-edge]')?.dataset.edge

    expect(edge()).toBe('bottom')

    await act(async () => root.render(<LanesAtStop isBottomOnly={false} />))

    expect(edge()).toBe('top')

    await act(async () => root.unmount())
    container.remove()
  })
})

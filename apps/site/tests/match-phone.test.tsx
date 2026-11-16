import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MatchTimeline } from '../src/components/match/review/MatchTimeline'
import { readInsights } from './match-fixtures'

const ignore = () => undefined

describe('the timeline readout under a finger', () => {
  let root: Root
  let container: HTMLElement

  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  async function mountTimeline(): Promise<HTMLElement> {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () =>
      root.render(
        <MatchTimeline
          insights={readInsights('duel-a')}
          timeline={null}
          selectedSlot={1}
          timeMs={20_000}
          onSeek={ignore}
          stops={[]}
          stopIndex={-1}
          onGoTo={ignore}
          opensBelow={false}
        />,
      ),
    )

    const plot = container.querySelector('[data-lane]')?.parentElement

    if (!plot) throw new Error('the timeline has no plot')

    // the dom lays nothing out; the plot is 300 px wide from the left edge
    plot.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 60, width: 300, height: 60 }) as DOMRect

    return plot
  }

  async function touch(target: Element, type: string, buttons: number) {
    const event = new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: 150, clientY: 20, buttons })

    await act(async () => {
      target.dispatchEvent(event)
    })
  }

  test('a press reads out where the finger is, and lifting it puts the readout away', async () => {
    const plot = await mountTimeline()
    const slider = plot.querySelector('[role="slider"]')

    if (!slider) throw new Error('the timeline has no slider')

    slider.setPointerCapture = ignore

    await touch(slider, 'pointerdown', 1)

    expect(container.querySelector('[data-timeline-readout]')).not.toBeNull()

    await touch(slider, 'pointermove', 1)

    expect(container.querySelector('[data-timeline-readout]')).not.toBeNull()

    await touch(slider, 'pointerup', 0)

    expect(container.querySelector('[data-timeline-readout]')).toBeNull()

    await act(async () => root.unmount())
    container.remove()
  })
})

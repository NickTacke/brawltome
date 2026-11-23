import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { shownOnStage } from '../src/components/match/stage/StageControls'
import { StageFrame } from '../src/components/match/stage/StageFrame'
import { useStageControls } from '../src/components/match/stage/use-stage-controls'

const ignore = () => undefined
const pageScreen = { isOn: false, isOverlay: false, exit: ignore, toggle: ignore }
const filledScreen = { ...pageScreen, isOn: true }

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
  jest.useRealTimers()
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

type ProbeProps = { isPlaying: boolean; isPhone?: boolean; isFullscreen?: boolean; isAtStop?: boolean }

// a stage with only its picture and a bar of controls, which says whether the controls show
function ControlsProbe({ isPlaying, isPhone = false, isFullscreen = false, isAtStop = false }: ProbeProps) {
  const controls = useStageControls({ isPlaying, onToggle: ignore, isPhone, isFullscreen, isAtStop })

  return (
    <div {...controls.stage} data-shown={controls.isShown}>
      <div data-stage-window />
      <div data-bar {...controls.bar} />
    </div>
  )
}

function isShown(): boolean {
  return find('[data-shown]').dataset.shown === 'true'
}

function pointer(selector: string, type: string, init: PointerEventInit = {}) {
  act(() => {
    find(selector).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse', ...init }))
  })
}

function wait(delayMs: number) {
  act(() => {
    jest.advanceTimersByTime(delayMs)
  })
}

describe('the controls over a stage that fills the screen', () => {
  test('go away about 2.5 s after the pointer stops, even paused, and come back as it moves', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying={false} isFullscreen />)

    pointer('[data-stage-window]', 'pointermove')

    expect(isShown()).toBe(true)

    wait(2400)

    expect(isShown()).toBe(true)

    wait(200)

    expect(isShown()).toBe(false)

    pointer('[data-stage-window]', 'pointermove')

    expect(isShown()).toBe(true)
  })

  test('stay on a paused page, as before', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying={false} />)

    pointer('[data-stage-window]', 'pointermove')
    wait(10_000)

    expect(isShown()).toBe(true)
  })

  test('stay while the pointer rests on them', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying isFullscreen />)

    pointer('[data-stage-window]', 'pointermove')
    // react tells a pointer entering one element from it going out of another
    pointer('[data-stage-window]', 'pointerout', { relatedTarget: find('[data-bar]') })
    wait(10_000)

    expect(isShown()).toBe(true)

    pointer('[data-bar]', 'pointerout', { relatedTarget: find('[data-stage-window]') })
    wait(2600)

    expect(isShown()).toBe(false)
  })

  test('let go of the fullscreen button that was pressed to fill the screen, which never hears the pointer leave', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying />)

    pointer('[data-stage-window]', 'pointerout', { relatedTarget: find('[data-bar]') })
    await act(async () => root.render(<ControlsProbe isPlaying isFullscreen />))
    pointer('[data-stage-window]', 'pointermove')
    wait(2600)

    expect(isShown()).toBe(false)
  })

  test('stay at a review’s stop while its card explains it', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying={false} isFullscreen isAtStop />)

    pointer('[data-stage-window]', 'pointermove')
    wait(10_000)

    expect(isShown()).toBe(true)
  })

  test('stay while a press scrubs, and go once it lets go', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying isFullscreen />)

    pointer('[data-bar]', 'pointerdown', { buttons: 1 })
    wait(10_000)

    expect(isShown()).toBe(true)

    pointer('[data-bar]', 'pointerup')
    wait(2600)

    expect(isShown()).toBe(false)
  })

  test('are not held up by a right press, whose menu takes the release', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying isFullscreen />)

    pointer('[data-stage-window]', 'pointerdown', { button: 2, buttons: 2 })
    wait(2600)

    expect(isShown()).toBe(false)
  })

  test('always show on a phone held upright, where they lie under the stage', async () => {
    jest.useFakeTimers()
    await mount(<ControlsProbe isPlaying isPhone isFullscreen />)

    pointer('[data-stage-window]', 'pointermove')
    wait(10_000)

    expect(isShown()).toBe(true)
  })

  test('take the pointer with them', () => {
    const frameFor = (isShown: boolean) =>
      renderToStaticMarkup(
        <StageFrame
          frameRef={{ current: null }}
          fullscreen={filledScreen}
          controls={{ ...shownControls, isShown }}
          aspect={16 / 9}
        >
          <div data-stage-window />
        </StageFrame>,
      )

    expect(frameFor(false)).toContain('cursor-none')
    expect(frameFor(true)).not.toContain('cursor-none')
  })

  test('fade, or come and go at once where less motion is asked for', () => {
    const hidden = shownOnStage(false).split(' ')

    expect(hidden).toContain('opacity-0')
    expect(hidden).toContain('transition')
    expect(hidden).toContain('motion-reduce:transition-none')
  })
})

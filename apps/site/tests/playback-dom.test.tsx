import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type Playback, usePlayback } from '../src/components/match/stage/use-playback'

// the match clock in a browser-like dom, run frame by frame by the test

const durationMs = 1000

// the frames the clock asked for and hasn't had yet, run when the test says a frame has come
const waitingFrames = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
let frameNowMs = 0

function runFrame(elapsedMs: number): void {
  frameNowMs += elapsedMs

  const callbacks = [...waitingFrames.values()]

  waitingFrames.clear()

  act(() => {
    for (const callback of callbacks) callback(frameNowMs)
  })
}

// the hook's latest result, as the component last rendered it
let playback: Playback

function Clock() {
  playback = usePlayback(durationMs)

  return null
}

const swappedGlobals = ['requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const

let globalsBefore: Map<string, PropertyDescriptor | undefined>
let root: Root

beforeAll(() => {
  globalsBefore = new Map(swappedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))

  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId++

    waitingFrames.set(id, callback)

    return id
  }

  globalThis.cancelAnimationFrame = (id) => {
    waitingFrames.delete(id)
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()

  for (const [name, descriptor] of globalsBefore) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function mount(): void {
  root = createRoot(document.createElement('div'))
  act(() => root.render(<Clock />))
}

// plays the match from the start to its end, a tenth of a second a frame
function playToTheEnd(): void {
  act(() => playback.toggle())

  for (let frame = 0; frame < 20 && playback.timeMs < durationMs; frame++) runFrame(100)
}

describe('the match clock', () => {
  test('stops playing at the end, and asks for no more frames', () => {
    mount()
    playToTheEnd()

    expect(playback.timeMs).toBe(durationMs)
    expect(playback.isPlaying).toBe(false)

    runFrame(100)

    expect(waitingFrames.size).toBe(0)

    act(() => root.unmount())
  })

  test('one press at the end plays the match again from the start', () => {
    mount()
    playToTheEnd()

    act(() => playback.toggle())

    expect(playback.timeMs).toBe(0)
    expect(playback.isPlaying).toBe(true)

    runFrame(100)
    runFrame(100)

    expect(playback.timeMs).toBeGreaterThan(0)

    act(() => root.unmount())
  })
})

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { MatchDetailContract } from '@brawltome/contracts'
import type { Replay } from '@brawltome/replay-player'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { matchDetailOf, readInsights, readPlayback } from './match-fixtures'

// these render the stage in a browser-like dom, so its effects run: loading the art and the timeline, drawing, keys

type Art = MatchDetailContract['art']
type Drawn = { replay: Replay }

const realPlayer = { ...(await import('@brawltome/replay-player')) }
const drawnReplays: Replay[] = []
const loadedManifests: string[] = []

// a replay with nothing to draw, loaded at once for the first match and never for the second, so the second match
// would show the first one's art if anything of it were kept
const firstReplay = { manifest: {}, players: new Map(), loaded: Promise.resolve() } as unknown as Replay

mock.module('@brawltome/replay-player', () => ({
  ...realPlayer,
  loadReplay: (manifestUrl: string) => {
    loadedManifests.push(manifestUrl)

    return manifestUrl.includes('first') ? Promise.resolve(firstReplay) : new Promise(() => undefined)
  },
}))

mock.module('../src/components/match/stage/draw-moment', () => ({
  drawMoment: (_canvas: unknown, match: Drawn) => {
    drawnReplays.push(match.replay)

    return true
  },
}))

const { MatchByKind } = await import('../src/components/match/MatchByKind')
const { MatchStage } = await import('../src/components/match/stage/MatchStage')

const timelineJson = JSON.stringify(readPlayback('duel-a'))

function artAt(name: string): Art {
  return { state: 'ready', manifestUrl: `https://art.test/manifests/${name}.json`, baseUrl: 'https://art.test/' }
}

// a match of the fixture with its own id, art and timeline address
function matchNamed(name: string): MatchDetailContract {
  const id = name === 'first' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222'
  const match = matchDetailOf('duel-a', artAt(name))

  return { ...match, id, playbackPath: `/match/${id}/playback/main-1/1` }
}

// lets the loads that have resolved land, and react render what they bring
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

let root: Root
let container: HTMLElement

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

  globalThis.fetch = (async () => new Response(timelineJson)) as unknown as typeof fetch

  // the stage takes the page's keys only while it is on screen, which this dom never works out on its own
  globalThis.IntersectionObserver = class {
    constructor(private readonly onChange: IntersectionObserverCallback) {}
    observe() {
      this.onChange([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    disconnect() {}
  } as unknown as typeof IntersectionObserver
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function mount(element: ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await act(async () => root.render(element))
  await settle()
}

async function unmount(): Promise<void> {
  await act(async () => root.unmount())
  container.remove()
}

describe('the stage in a browser', () => {
  test('another match never shows the art of the one before', async () => {
    await mount(<MatchByKind match={matchNamed('first')} />)

    expect(drawnReplays).toContain(firstReplay)

    drawnReplays.length = 0

    await act(async () => root.render(<MatchByKind match={matchNamed('second')} />))
    await settle()

    expect(drawnReplays).not.toContain(firstReplay)

    await unmount()
  })

  test('keys held with a modifier stay the browser’s, so find and its other shortcuts keep working', async () => {
    const match = matchNamed('first')

    await mount(<MatchStage insights={readInsights('duel-a')} art={match.art} playbackPath={match.playbackPath} />)

    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })

      window.dispatchEvent(event)

      return event.defaultPrevented
    }

    expect(press({ key: 'f', metaKey: true })).toBe(false)
    expect(press({ key: 'f', ctrlKey: true })).toBe(false)
    expect(press({ key: 'ArrowLeft', altKey: true })).toBe(false)
    expect(press({ key: 'ArrowRight', ctrlKey: true })).toBe(false)
    expect(press({ key: 'ArrowRight' })).toBe(true)

    await unmount()
  })

  test('a match without a timeline downloads no art', async () => {
    loadedManifests.length = 0

    await mount(<MatchStage insights={readInsights('duel-a')} art={artAt('first')} playbackPath={null} />)

    expect(loadedManifests).toEqual([])

    await unmount()
  })
})

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { MatchDetailContract, ReviewScope } from '@brawltome/contracts'
import type { Replay } from '@brawltome/replay-player'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { formatClock } from '../src/components/match/match-format'
import { matchDetailOf, readInsights, readPlayback } from './match-fixtures'

// these render the stage in a browser-like dom, so its effects run: loading the art and the timeline, drawing, keys

type Art = MatchDetailContract['art']
type Drawn = { replay: Replay }

const realPlayer = { ...(await import('@brawltome/replay-player')) }
const drawnReplays: Replay[] = []
const loadedManifests: string[] = []

// a replay with nothing to draw, loaded at once for the first match and never for the second, so the second match
// would show the first one's art if anything of it were kept
const firstReplay = {
  manifest: { map: { layout: 'maps/4444.json' } },
  players: new Map(),
  loaded: Promise.resolve(),
  assetUrl: (path: string) => `https://art.test/${path}`,
} as unknown as Replay

// the first match's map file, which names an image for one of its two platforms
const platformImage = 'sheets/10a43fccdae5677c.webp'
const mapFileJson = JSON.stringify({ artAssets: { 'Space.Platform_Space1.png': platformImage } })

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
const { ReplayWithArt } = await import('./replay-with-art')

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

  globalThis.fetch = (async (url: string) =>
    new Response(String(url).includes('/maps/') ? mapFileJson : timelineJson)) as unknown as typeof fetch

  // frames never come, so the clock and the camera stand still between the steps a test takes, and nothing renders
  // outside act
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => undefined

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

    await mount(
      <ReplayWithArt
        insights={readInsights('duel-a')}
        art={match.art}
        playbackPath={match.playbackPath}
        selectedSlot={1}
      />,
    )

    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })

      // a key the stage takes moves its clock, which react has to be told of
      act(() => {
        window.dispatchEvent(event)
      })

      return event.defaultPrevented
    }

    expect(press({ key: 'f', metaKey: true })).toBe(false)
    expect(press({ key: 'f', ctrlKey: true })).toBe(false)
    expect(press({ key: 'ArrowLeft', altKey: true })).toBe(false)
    expect(press({ key: 'ArrowRight', ctrlKey: true })).toBe(false)
    expect(press({ key: 'ArrowRight' })).toBe(true)

    await unmount()
  })

  test('once the map file is in, the platforms it names an image for are drawn and the rest are skipped', async () => {
    const match = matchNamed('first')
    const insights = readInsights('duel-a')
    const piece = { x: 0.25, y: 0.5, width: 0.5, height: 0.25, rotation: 0 }

    const art = [
      { ...piece, file: 'Space.Platform_Space1.png' },
      { ...piece, file: 'Space.Platform_Space1B.png' },
    ]

    const withArt = { ...insights, insights: { ...insights.insights, stage: { ...insights.insights.stage, art } } }

    await mount(<ReplayWithArt insights={withArt} art={match.art} playbackPath={match.playbackPath} selectedSlot={1} />)

    const images = [...container.querySelectorAll('svg image')].map((image) => image.getAttribute('href'))

    expect(images).toEqual([`https://art.test/${platformImage}`])

    await unmount()
  })

  test('a match without a timeline downloads no art', async () => {
    loadedManifests.length = 0

    await mount(
      <ReplayWithArt insights={readInsights('duel-a')} art={artAt('first')} playbackPath={null} selectedSlot={1} />,
    )

    expect(loadedManifests).toEqual([])

    await unmount()
  })
})

// the times of the stops along the lanes, as their buttons name them, in the order of the match
function stopLabels(): string[] {
  const buttons = [...container.querySelectorAll('button[aria-label^="Stop "]')]

  return buttons.map((button) => button.getAttribute('aria-label') ?? '').sort(byStopNumber)
}

function byStopNumber(left: string, right: string): number {
  return Number(left.split(' ')[1]) - Number(right.split(' ')[1])
}

function stopTimes(slot: number, scope: ReviewScope): number[] {
  const { reviewStops } = readInsights('duel-a')

  return reviewStops.filter((stop) => stop.slot === slot && stop.scope === scope).map((stop) => stop.timeMs)
}

function labelsOf(times: number[]): string[] {
  return times.map((timeMs, index) => `Stop ${index + 1} at ${formatClock(timeMs)}`)
}

function clockNow(): number {
  return Number(container.querySelector('[aria-label="Match time"]')?.getAttribute('aria-valuenow'))
}

async function pressLabelled(label: string): Promise<void> {
  const button = container.querySelector(`button[aria-label="${label}"]`)

  if (!(button instanceof HTMLElement)) throw new Error(`press ${label}: no such button`)

  await act(async () => button.click())
  await settle()
}

async function press(label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === label)

  if (!button) throw new Error(`press ${label}: no such button`)

  await act(async () => button.click())
  await settle()
}

describe('the review in a browser', () => {
  const match = matchNamed('first')

  const replayFor = (slot: number) => (
    <ReplayWithArt
      insights={readInsights('duel-a')}
      art={match.art}
      playbackPath={match.playbackPath}
      selectedSlot={slot}
    />
  )

  test('picking another player restarts the review on their stops and keeps the loaded replay', async () => {
    loadedManifests.length = 0
    drawnReplays.length = 0

    await mount(replayFor(1))
    await press('Review')
    await pressLabelled('Review: Key moments · 12')
    await press('Hits taken · 28')
    await pressLabelled('Next stop')
    await pressLabelled('Next stop')

    expect(stopLabels()).toEqual(labelsOf(stopTimes(1, 'taken')))

    const clockMs = clockNow()

    await act(async () => root.render(replayFor(2)))
    await settle()

    const slotTwoTimes = stopTimes(2, 'taken')
    const headedFor = slotTwoTimes.findIndex((timeMs) => timeMs > clockMs)

    expect(stopLabels()).toEqual(labelsOf(slotTwoTimes))

    expect(container.querySelector('button[aria-current="true"]')?.getAttribute('aria-label')).toBe(
      labelsOf(slotTwoTimes)[headedFor],
    )

    expect(clockNow()).toBe((slotTwoTimes[headedFor] ?? 0) - 1500)
    expect(loadedManifests).toEqual([match.art.manifestUrl ?? ''])
    expect(new Set(drawnReplays)).toEqual(new Set([firstReplay]))

    await unmount()
  })

  test('the lanes keep their full size when the review starts and when it ends', async () => {
    await mount(replayFor(1))

    for (const mode of ['Review', 'Watch']) {
      await press(mode)

      const lanes = [...container.querySelectorAll('[data-lane]')]

      expect(lanes).toHaveLength(2)

      for (const lane of lanes) expect(lane.className).toContain('h-6')
    }

    await unmount()
  })
})

// the text of the page's section under a heading
function sectionText(heading: string): string {
  const sections = [...container.querySelectorAll('section')]
  const section = sections.find((entry) => entry.querySelector('h2')?.textContent === heading)

  return section?.textContent ?? ''
}

function playerRow(name: string): HTMLElement {
  const row = [...container.querySelectorAll('button[aria-pressed]')].find(
    (button) => !button.hasAttribute('aria-label') && button.textContent?.startsWith(name),
  )

  if (!(row instanceof HTMLElement)) throw new Error(`pick ${name}: no such row`)

  return row
}

describe('the match page in a browser', () => {
  test('picking another player turns the page and the review to them and keeps the loaded replay', async () => {
    loadedManifests.length = 0

    const match = matchNamed('first')
    const insights = readInsights('duel-a')
    const openingsOf = (slot: number) => insights.insights.players.find((entry) => entry.slot === slot)?.neutral

    await mount(<MatchByKind match={match} />)
    await press('Review')
    await pressLabelled(`Review: Key moments · ${stopTimes(2, 'key').length}`)
    await press(`Hits taken · ${stopTimes(2, 'taken').length}`)

    expect(sectionText('Neutral')).toContain('Player B')
    expect(stopLabels()).toEqual(labelsOf(stopTimes(2, 'taken')))

    const pick = playerRow('Player A')

    await act(async () => pick.click())
    await settle()

    expect(sectionText('Neutral')).toContain('Player A')
    expect(sectionText('Neutral')).toContain(`${openingsOf(1)?.openingsWon} won`)
    expect(stopLabels()).toEqual(labelsOf(stopTimes(1, 'taken')))
    expect(loadedManifests).toEqual([match.art.manifestUrl ?? ''])

    await unmount()
  })

  test('picking another player closes an opened way of opening, which was about the player before', async () => {
    await mount(<MatchByKind match={matchNamed('first')} />)

    const openings = () => container.querySelector('section[aria-labelledby="openings"]')
    const openedRows = () => openings()?.querySelectorAll('button[aria-expanded="true"]').length ?? 0
    const firstKind = openings()?.querySelector('button[aria-expanded]')

    if (!(firstKind instanceof HTMLElement)) throw new Error('open an opening kind: none listed')

    await act(async () => firstKind.click())
    await settle()

    expect(openedRows()).toBeGreaterThan(0)

    const pick = playerRow('Player A')

    await act(async () => pick.click())
    await settle()

    expect(openedRows()).toBe(0)
    expect(openings()?.querySelector('[aria-label="Close details"]')).toBeNull()

    await unmount()
  })
})

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { MatchDetailContract, ReviewScope, StageArt } from '@brawltome/contracts'
import type { Replay } from '@brawltome/replay-player'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MatchByKind } from '../src/components/match/MatchByKind'
import { formatClock } from '../src/components/match/match-format'
import { type StageTools, StageToolsContext } from '../src/components/match/stage/stage-tools'
import { matchDetailOf, readInsights, readPlayback } from './match-fixtures'
import { ReplayWithArt } from './replay-with-art'

// these render the stage in a browser-like dom, so its effects run: loading the art and the timeline, drawing, keys

type Art = MatchDetailContract['art']
type Drawn = { replay: Replay }

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

// a replay whose first seconds load but whose later art fails, made when loaded so the failure is always handled
function brokenReplay(): Replay {
  return { ...firstReplay, loaded: Promise.reject(new Error('fetch a sheet: 404')) } as Replay
}

// the first match's map file, which names an image for one of its two platforms
const platformImage = 'sheets/10a43fccdae5677c.webp'
const mapFileJson = JSON.stringify({ artAssets: { 'Space.Platform_Space1.png': platformImage } })

// the page's checks on art still being drawn, each waiting for the test to answer it
const artChecks: ((art: Art) => void)[] = []

// the stage loads and draws through these instead of the real ones, so the test sees which art it loaded and drew
const tools: StageTools = {
  readMatchArt: () => new Promise<Art>((resolve) => artChecks.push(resolve)),
  artCheckEveryMs: 1,
  loadReplay: async (manifestUrl, options) => {
    loadedManifests.push(String(manifestUrl))

    if (String(manifestUrl).includes('broken')) return brokenReplay()

    if (String(manifestUrl).includes('missing')) {
      options.onMissing?.('2', new Error('load replay file sheets/0000000000000000.webp: HTTP 404'))

      return firstReplay
    }

    return String(manifestUrl).includes('first') ? firstReplay : new Promise<Replay>(() => undefined)
  },
  drawMoment: (_canvas, match: Drawn) => {
    drawnReplays.push(match.replay)

    return true
  },
}

function withTools(element: ReactNode): ReactNode {
  return <StageToolsContext value={tools}>{element}</StageToolsContext>
}

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

// what this file swaps on the global object, put back after it, as other test files share the process
const swappedGlobals = [
  'fetch',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IntersectionObserver',
  'IS_REACT_ACT_ENVIRONMENT',
] as const

let globalsBefore: Map<string, PropertyDescriptor | undefined>

beforeAll(() => {
  globalsBefore = new Map(swappedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))

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

  for (const [name, descriptor] of globalsBefore) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

async function mount(element: ReactNode): Promise<void> {
  // every test starts with the lanes as a new viewer has them
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await act(async () => root.render(withTools(element)))
  await settle()
}

async function unmount(): Promise<void> {
  await act(async () => root.unmount())
  container.remove()
}

describe('the stage in a browser', () => {
  test('art that fails after the first seconds makes the legends unavailable, so the portraits play instead', async () => {
    const errorBefore = console.error

    console.error = () => undefined

    await mount(<MatchByKind match={matchNamed('broken')} />)

    console.error = errorBefore

    expect(container.querySelector('[data-stage-window]')?.parentElement?.textContent).toContain(
      'Legends unavailable for this match',
    )

    await unmount()
  })

  test('a player whose art cannot load is reported, and the legends still play', async () => {
    const errorBefore = console.error
    const reported: unknown[][] = []

    console.error = (...parts: unknown[]) => reported.push(parts)

    await mount(<MatchByKind match={matchNamed('missing')} />)

    console.error = errorBefore

    expect(reported.map(([what]) => what)).toEqual([
      'load the art of player 2 at https://art.test/manifests/missing.json:',
    ])

    expect(container.querySelector('[data-stage-window]')?.parentElement?.textContent).not.toContain(
      'Legends unavailable for this match',
    )

    await unmount()
  })

  test('where the browser refuses fullscreen, the stage is laid over the screen from the body, outside the page', async () => {
    const requestBefore = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen')

    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new TypeError('fullscreen is not allowed'))

    await mount(<MatchByKind match={matchNamed('first')} />)

    const press = async (label: string) => {
      await act(async () => container.ownerDocument.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click())
      await settle()
    }

    await press('Fullscreen')

    const overlaid = document.querySelector('[data-stage-window]')

    expect(container.contains(overlaid)).toBe(false)
    expect(overlaid?.closest('body > *')?.className).toContain('fixed inset-0')

    await press('Leave fullscreen')

    expect(container.contains(document.querySelector('[data-stage-window]'))).toBe(true)

    await unmount()

    if (requestBefore) Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', requestBefore)
    else Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
  })

  test('another match never shows the art of the one before', async () => {
    await mount(<MatchByKind match={matchNamed('first')} />)

    expect(drawnReplays).toContain(firstReplay)

    drawnReplays.length = 0

    await act(async () => root.render(withTools(<MatchByKind match={matchNamed('second')} />)))
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

  // what react reports while the first match's stage draws these pieces; two children with one key is such a report
  async function reportsWhileDrawing(art: StageArt[]): Promise<unknown[]> {
    const match = matchNamed('first')
    const insights = readInsights('duel-a')
    const withArt = { ...insights, insights: { ...insights.insights, stage: { ...insights.insights.stage, art } } }
    const reports: unknown[] = []
    const errorBefore = console.error

    console.error = (...report: unknown[]) => reports.push(report[0])
    await mount(<ReplayWithArt insights={withArt} art={match.art} playbackPath={match.playbackPath} selectedSlot={1} />)
    console.error = errorBefore

    return reports
  }

  const twinPiece = { file: 'Space.Platform_Space1.png', x: 0.25, y: 0.5, width: 0.5, height: 0.25, rotation: 0 }

  test('a platform and its twin mirrored upwards on the same corner are two images', async () => {
    const reports = await reportsWhileDrawing([twinPiece, { ...twinPiece, height: -0.25 }])

    expect(container.querySelectorAll('svg image')).toHaveLength(2)
    expect(reports).toEqual([])

    await unmount()
  })

  test('a platform and its twin mirrored sideways on the same corner are two images', async () => {
    const reports = await reportsWhileDrawing([twinPiece, { ...twinPiece, width: -0.5 }])

    expect(container.querySelectorAll('svg image')).toHaveLength(2)
    expect(reports).toEqual([])

    await unmount()
  })

  test('moving platforms that start in one place repeat a piece exactly and are each drawn', async () => {
    const reports = await reportsWhileDrawing([twinPiece, { ...twinPiece }, { ...twinPiece }])

    expect(container.querySelectorAll('svg image')).toHaveLength(3)
    expect(reports).toEqual([])

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

    await act(async () => root.render(withTools(replayFor(2))))
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

  test('T folds the lanes into a thin bar and back, and the review steps on over the bar', async () => {
    const pressKey = (key: string) =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })

    await mount(replayFor(1))
    await press('Review')

    pressKey('t')

    expect(container.querySelectorAll('[data-lane]')).toHaveLength(0)
    expect(container.querySelector('[data-folded-timeline]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Show timeline"]')).not.toBeNull()

    const clockMs = clockNow()

    await pressLabelled('Next stop')

    expect(clockNow()).toBeGreaterThan(clockMs)
    expect(container.querySelector('[aria-label="Speed 1×, switch to 2×"]')).not.toBeNull()

    pressKey('T')

    expect(container.querySelectorAll('[data-lane]')).toHaveLength(2)
    expect(container.querySelector('[data-folded-timeline]')).toBeNull()

    await unmount()
    window.localStorage.clear()
  })

  test('T keeps keyboard focus on a control it keeps, and hands it to the fold button from a stop it takes away', async () => {
    const pressKey = (key: string) =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })

    const focus = (selector: string) =>
      act(() => {
        container.querySelector<HTMLElement>(selector)?.focus()
      })

    await mount(replayFor(1))
    await press('Review')

    focus('[aria-label="Next stop"]')
    pressKey('t')

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Next stop')

    pressKey('t')
    focus('button[aria-label^="Stop "]')
    pressKey('t')

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show timeline')

    await unmount()
    window.localStorage.clear()
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

const queuedArt: Art = { state: 'queued', manifestUrl: null, baseUrl: null }
const failedArt: Art = { state: 'failed', manifestUrl: null, baseUrl: null }

// lets time pass until the page has checked on its art again, or a while, when it no longer does
async function waitForArtCheck(): Promise<boolean> {
  for (let round = 0; round < 20 && artChecks.length === 0; round++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
  }

  return artChecks.length > 0
}

async function answerArtCheck(art: Art): Promise<void> {
  if (!(await waitForArtCheck())) throw new Error(`answer an art check with ${art.state}: the page asked for none`)

  const answer = artChecks.shift()

  await act(async () => answer?.(art))
  await settle()
}

function stageText(): string {
  return container.querySelector('[data-stage-window]')?.parentElement?.textContent ?? ''
}

describe('a match whose legends are still being drawn', () => {
  const pendingMatch = () => ({ ...matchNamed('first'), art: queuedArt })

  test('says so, checks again, and draws them once they are in without starting the match over', async () => {
    artChecks.length = 0
    drawnReplays.length = 0

    await mount(<MatchByKind match={pendingMatch()} />)

    expect(stageText()).toContain('Drawing legends…')

    await answerArtCheck(queuedArt)

    expect(stageText()).toContain('Drawing legends…')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    })

    const clockMs = clockNow()

    expect(clockMs).toBeGreaterThan(0)

    await answerArtCheck(artAt('first'))

    expect(drawnReplays).toContain(firstReplay)
    expect(stageText()).not.toContain('Drawing legends…')
    expect(clockNow()).toBe(clockMs)
    expect(await waitForArtCheck()).toBe(false)

    await unmount()
  })

  test('says they are unavailable once drawing them failed, and stops checking', async () => {
    artChecks.length = 0

    await mount(<MatchByKind match={pendingMatch()} />)
    await answerArtCheck(failedArt)

    expect(stageText()).toContain('Legends unavailable for this match')
    expect(stageText()).not.toContain('Drawing legends…')
    expect(await waitForArtCheck()).toBe(false)

    await unmount()
  })

  test('stops checking after five minutes of checks', async () => {
    artChecks.length = 0

    await mount(<MatchByKind match={pendingMatch()} />)

    for (let check = 0; check < 30; check++) await answerArtCheck(queuedArt)

    expect(await waitForArtCheck()).toBe(false)

    await unmount()
  })
})

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchPage } from '../src/components/match/MatchPage'
import { lanePlayersOf } from '../src/components/match/review/lane-players'
import { MatchTimeline } from '../src/components/match/review/MatchTimeline'
import { ReviewCardSlot } from '../src/components/match/review/ReviewCardSlot'
import { SpeedButton, TransportColumn } from '../src/components/match/stage/ReviewControls'
import { StageDeck } from '../src/components/match/stage/StageDeck'
import { phoneQuery } from '../src/components/match/use-phone-layout'
import { matchDetailOf, readInsights } from './match-fixtures'

const ignore = () => undefined
const queuedArt = { state: 'queued', manifestUrl: null, baseUrl: null } as const

// the opening tag of the first element carrying an attribute
function tagWith(markup: string, attribute: string): string {
  const tag = new RegExp(`<[^>]*${attribute}[^>]*>`).exec(markup)?.[0]

  if (!tag) throw new Error(`no element with ${attribute}`)

  return tag
}

function tagsWith(markup: string, attribute: string): string[] {
  return [...markup.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, 'g'))].map((match) => match[0])
}

// what a reader sees of some markup: its words, one space apart
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function classOf(tag: string): string[] {
  return /class="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? []
}

// where a piece of the page goes on a phone: its order there, or the order it has once the columns come apart
function phoneOrderOf(tag: string): number {
  const classes = classOf(tag)

  const order =
    classes.find((name) => name.startsWith('phone:order-')) ?? classes.find((name) => name.startsWith('max-xl:order-'))

  return Number(order?.split('order-')[1] ?? 0)
}

function renderPage(): string {
  const match = matchDetailOf('duel-a', queuedArt)

  return renderToStaticMarkup(<MatchPage match={match} insights={readInsights('duel-a')} />)
}

const playback = {
  timeMs: 20_000,
  durationMs: 170_000,
  isPlaying: false,
  speed: 1,
  toggle: ignore,
  seek: ignore,
  setSpeed: ignore,
  setScale: ignore,
  isBuffering: false,
  setIsBuffering: ignore,
  play: ignore,
  pause: ignore,
}

const stepping = { backLabel: 'Back', onLabel: 'On', canStepBack: true, canStepOn: true, onStep: ignore }

const shownControls = {
  isShown: true,
  isHeld: false,
  wake: ignore,
  stage: { onPointerMove: ignore, onPointerDown: ignore, onPointerLeave: ignore, onClick: ignore },
  bar: { onPointerEnter: ignore, onPointerLeave: ignore },
}

const pageScreen = { isOn: false, isOverlay: false, exit: ignore, toggle: ignore }

describe('the match page on a phone', () => {
  test('the phone variant asks the same as the page’s own media query', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

    expect(styles).toContain(`@custom-variant phone {\n  @media ${phoneQuery} {`)
  })

  test('the stage comes first, then the controls, the lanes and the flat lead', () => {
    const markup = renderPage()
    const order = ['data-stage-window', 'data-stage-transport', 'data-stage-controls=', 'data-lead="flat"']
    const positions = order.map((attribute) => markup.indexOf(attribute))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
  })

  test('a review’s card lies under the lanes', () => {
    const markup = renderToStaticMarkup(
      <StageDeck
        controls={shownControls}
        fullscreen={pageScreen}
        lanes={{ edge: 'bottom' }}
        transport={<span>transport</span>}
        timeline={() => <span>lanes</span>}
        speed={null}
        tools={null}
        note={null}
        card={<div data-review-card />}
      />,
    )

    expect(markup.indexOf('data-stage-transport')).toBeLessThan(markup.indexOf('data-stage-controls='))
    expect(markup.indexOf('data-stage-controls=')).toBeLessThan(markup.indexOf('data-review-card'))
  })

  test('the card under the lanes is the upright one, numbered like the stop', () => {
    const insights = readInsights('duel-a')
    const moment = insights.insights.moments.find((entry) => entry.key === 'punish-2')

    if (!moment) throw new Error('find punish-2 in duel-a: not there')

    const markup = renderToStaticMarkup(
      <ReviewCardSlot
        moment={moment}
        lanes={lanePlayersOf(insights)}
        count={{ index: 1, total: 12, onReplay: ignore }}
      />,
    )

    // the upright card names the cost beside the stop, before who hit whom; the wide one after
    expect(tagWith(markup, 'data-review-card')).not.toContain('absolute')
    expect(textOf(markup)).toStartWith('2 of 12 Big punish 30 Player A hit by Player B')
  })

  test('who played comes after the replay, the map’s name before it', () => {
    const markup = renderPage()
    const pieces = tagsWith(markup, 'data-column-piece=')
    const nameOf = (tag: string) => /data-column-piece="([^"]+)"/.exec(tag)?.[1]

    const ordered = pieces
      .map((tag, index) => ({ tag, index }))
      .sort((left, right) => phoneOrderOf(left.tag) - phoneOrderOf(right.tag) || left.index - right.index)

    expect(ordered.map(({ tag }) => nameOf(tag))).toEqual(['identity', 'replay', 'players', 'neutral', 'modules'])
  })

  test('the lanes keep their full size and stay in sight under the stage', () => {
    const markup = renderPage()
    const panel = classOf(tagWith(markup, 'data-stage-controls='))

    expect(panel).toContain('phone:opacity-100')
    expect(panel).toContain('phone:pointer-events-auto')

    for (const lane of tagsWith(markup, 'data-lane=')) {
      const classes = classOf(lane)

      expect(classes).toContain('h-6')
      expect(classes.filter((name) => name.includes(':'))).toEqual([])
    }
  })
})

describe('tap targets on a phone', () => {
  // 44 px, as the guidelines for touch ask
  const fingerSized = ['phone:size-11', 'phone:min-h-11', 'min-h-11']

  function buttonsOf(markup: string): string[] {
    return [...markup.matchAll(/<button[^>]*>/g)].map((match) => match[0])
  }

  function expectFingerSized(markup: string) {
    const buttons = buttonsOf(markup)

    expect(buttons.length).toBeGreaterThan(0)

    for (const button of buttons) expect(classOf(button).some((name) => fingerSized.includes(name))).toBe(true)
  }

  test('the transport, the speed and the stop count', () => {
    const count = { index: 2, total: 12, onReplay: ignore }

    expectFingerSized(renderToStaticMarkup(<TransportColumn playback={playback} stepping={stepping} count={null} />))
    expectFingerSized(renderToStaticMarkup(<TransportColumn playback={playback} stepping={stepping} count={count} />))
    expectFingerSized(renderToStaticMarkup(<SpeedButton playback={playback} />))
  })

  test('the fullscreen button', () => {
    const markup = renderPage()

    expect(classOf(tagWith(markup, 'aria-label="Fullscreen"'))).toContain('phone:size-11')
  })
})

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

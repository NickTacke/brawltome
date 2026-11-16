import { describe, expect, test } from 'bun:test'
import type { MatchInsights, ReviewStop } from '@brawltome/contracts'
import { placeCard } from '../src/components/match/review/callout-place'
import { reviewPhaseOf } from '../src/components/match/review/review-phase'
import { reviewChoicesOf } from '../src/components/match/review/review-stops'
import { damageText, pointerTimeMs } from '../src/components/match/review/timeline-readout'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import { type Pose, posesAt } from '../src/components/match/stage/pose'
import { transportCornerPx } from '../src/components/match/stage/StageControls'
import { tagHeightPx, tagLifts, tagWidthPx } from '../src/components/match/stage/tag-stack'
import { advanceClockMs } from '../src/components/match/stage/use-playback'
import { type InsightsFixture, readInsights, readPlayback } from './match-fixtures'

// a player standing at a spot of the frame, in shares
function poseAt(slot: number, x: number, y: number): Pose {
  return {
    slot,
    x,
    y,
    isInPlay: true,
    facingRight: true,
    weapon: 'Unarmed',
    isHitstun: false,
    isDodging: false,
    damage: 0,
    stocksLeft: 3,
  }
}

const frame = { width: 1000, height: 560 }

// every pair of tags lifted over their players, as laid out in the frame's pixels
function overlappingPairs(poses: Pose[]): [number, number][] {
  const lifts = tagLifts(poses, frame)

  const tags = poses.map((pose) => ({
    slot: pose.slot,
    x: pose.x * frame.width,
    y: pose.y * frame.height - (lifts.get(pose.slot) ?? 0) * tagHeightPx,
  }))

  return tags.flatMap((tag, index) =>
    tags
      .slice(index + 1)
      .filter((other) => Math.abs(other.x - tag.x) < tagWidthPx && Math.abs(other.y - tag.y) < tagHeightPx)
      .map((other): [number, number] => [tag.slot, other.slot]),
  )
}

describe('the tags over the players', () => {
  test('four players a little apart on one spot get four tags that never lie on each other', () => {
    // each a half tag lower than the one before, so a lifted tag can block two levels of the next player
    const poses = [1, 2, 3, 4].map((slot) => poseAt(slot, 0.5, 0.5 + ((slot - 1) * tagHeightPx) / 2 / frame.height))

    expect(overlappingPairs(poses)).toEqual([])
  })

  test.each(['duel-a', 'doubles-b'] as const)('in %s no two tags overlap at any moment', (name) => {
    const insights = readInsights(name)
    const timeline = readPlaybackTimeline(readPlayback(name))
    const { box, durationMs } = insights.insights.stage

    for (let timeMs = 0; timeMs < durationMs; timeMs += 250) {
      const shown = posesAt(timeline, box, timeMs).filter((pose) => pose.isInPlay)

      expect({ timeMs, pairs: overlappingPairs(shown) }).toEqual({ timeMs, pairs: [] })
    }
  })
})

describe('the replay clock', () => {
  test('moves by the time since the last frame at the speed picked, slowed by the scale', () => {
    expect(advanceClockMs(1000, 16, { speed: 1, scale: 1 }, 5000)).toBe(1016)
    expect(advanceClockMs(1000, 16, { speed: 2, scale: 1 }, 5000)).toBe(1032)
    expect(advanceClockMs(1000, 20, { speed: 2, scale: 0.3 }, 5000)).toBe(1012)
  })

  test('stops at the end of the match', () => {
    expect(advanceClockMs(4990, 100, { speed: 4, scale: 1 }, 5000)).toBe(5000)
  })
})

// the damage the timeline itself gives a player at a time of the clock: at the step the time falls in, rounded to a
// whole number, and a dash while the player is out of play
function timelineDamageText(pose: Pose | undefined): string {
  if (!pose?.isInPlay) return '–'

  return String(Math.round(pose.damage))
}

describe('the readout over the lanes', () => {
  test.each(['duel-a', 'doubles-b'] as const)('in %s every damage it shows is the timeline’s', (name) => {
    const insights = readInsights(name)
    const timeline = readPlaybackTimeline(readPlayback(name))
    const { box, durationMs, stepMs } = insights.insights.stage

    for (let share = 0; share <= 1; share += 0.0005) {
      const timeMs = pointerTimeMs(share, durationMs, stepMs)
      const poses = posesAt(timeline, box, timeMs)

      for (const player of insights.insights.players) {
        const want = timelineDamageText(poses.find((pose) => pose.slot === player.slot))

        expect({ share, slot: player.slot, text: damageText(player.stocks, timeMs) }).toEqual({
          share,
          slot: player.slot,
          text: want,
        })
      }
    }
  })

  test.each(['duel-a', 'doubles-b'] as const)('in %s it reads every KO as the timeline does', (name) => {
    const insights = readInsights(name)
    const timeline = readPlaybackTimeline(readPlayback(name))
    const { box, stepMs } = insights.insights.stage

    for (const knockout of insights.insights.knockouts) {
      const stocks = insights.insights.players.find((player) => player.slot === knockout.victim)?.stocks ?? []

      for (const timeMs of [knockout.timeMs - stepMs, knockout.timeMs]) {
        const pose = posesAt(timeline, box, timeMs).find((entry) => entry.slot === knockout.victim)

        expect({ timeMs, text: damageText(stocks, timeMs) }).toEqual({ timeMs, text: timelineDamageText(pose) })
      }
    }
  })

  test('a pointer between two steps reads the step it is in, as the timeline does', () => {
    const { insights } = readInsights('duel-b')
    const { durationMs, stepMs } = insights.stage
    // 38% of the way through duel-b, while Player B takes a three hit string whose damage changes every few steps
    const timeMs = pointerTimeMs(0.38, durationMs, stepMs)
    const playerB = insights.players.find((player) => player.slot === 2)

    expect(timeMs).toBe(102_368)
    expect(damageText(playerB?.stocks ?? [], timeMs)).toBe('11')
    expect(damageText(playerB?.stocks ?? [], 102_064 - 1)).toBe('3')
  })
})

type Size = { width: number; height: number }

// every player where the insights' position tracks have them at a time; out of play where a track has no sample near it
function trackedPoses(insights: MatchInsights, timeMs: number): Pose[] {
  const { marks, sampleMs } = insights.insights.stage

  return marks.tracks.flatMap((track) => {
    const spot = track.spots.findLast(([atMs]) => atMs <= timeMs)

    if (!spot) return []

    const pose = poseAt(track.slot, spot[1], spot[2])

    return [{ ...pose, isInPlay: timeMs - spot[0] <= sampleMs * 4 }]
  })
}

// the stage at the widths a desktop page gives it, the cards as tall as their longest stop, and the lanes' band as
// high as the panel of lanes with its gap: two lanes in a duel, four with a gap between the teams in doubles
const stageWidthsPx = [640, 780, 1040, 1300]
// fullscreen keeps the lanes on the bottom edge
const fullscreenWidthsPx = [1640, 1920, 2040]
const uprightCard: Size = { width: 288, height: 196 }
const wideCard = (stage: Size): Size => ({ width: Math.min(480, stage.width - 16), height: 84 })

const corners = (stage: Size) => [
  { left: stage.width - 48, top: 0, right: stage.width, bottom: 48 },
  { left: 0, top: stage.height - transportCornerPx.height, right: transportCornerPx.width, bottom: stage.height },
  { left: 0, top: 0, right: 240, bottom: 30 },
]

function isInside(place: { x: number; y: number }, card: Size, stage: Size): boolean {
  return place.x >= 0 && place.y >= 0 && place.x + card.width <= stage.width && place.y + card.height <= stage.height
}

type Edge = 'top' | 'bottom'
type Check = { key: string; width: number; edge: Edge; isInside: boolean; isOffLanes: boolean; isClear: boolean }

// the card a review stop gets, as the page picks it: upright where it has a place clear of the stop's players, wide
// where it hasn't
function checkStop(insights: MatchInsights, stop: ReviewStop, stage: Size, edge: Edge): Check {
  const moment = insights.insights.moments.find((entry) => entry.key === stop.momentKey)
  const poses = trackedPoses(insights, stop.timeMs)
  const players = { victim: moment?.victim ?? null, attacker: moment?.attacker ?? null }
  const bandPx = insights.summary.players.length > 2 ? 130 : 74
  const space = (card: Size) => ({ card, stage, panel: { edge, bandPx }, obstacles: corners(stage) })
  const upright = placeCard(poses, space(uprightCard), players)
  const card = upright.isOnStopPlayers ? wideCard(stage) : uprightCard
  const place = upright.isOnStopPlayers ? placeCard(poses, space(card), players) : upright
  const isOffLanes = edge === 'top' ? place.y >= bandPx : place.y + card.height <= stage.height - bandPx

  return {
    key: stop.momentKey,
    width: stage.width,
    edge,
    isInside: isInside(place, card, stage),
    isOffLanes,
    isClear: !place.isOnStopPlayers,
  }
}

function checkEveryStop(name: InsightsFixture): Check[] {
  const insights = readInsights(name)
  const stageOf = (width: number) => ({ width, height: width / insights.insights.stage.aspect })

  const onPage = stageWidthsPx.flatMap((width) => [
    { stage: stageOf(width), edge: 'top' as const },
    { stage: stageOf(width), edge: 'bottom' as const },
  ])

  const fullscreen = fullscreenWidthsPx.map((width) => ({ stage: stageOf(width), edge: 'bottom' as const }))
  const layouts = [...onPage, ...fullscreen]

  return insights.reviewStops.flatMap((stop) =>
    layouts.map(({ stage, edge }) => checkStop(insights, stop, stage, edge)),
  )
}

describe('the card at a review stop', () => {
  const fixtures: InsightsFixture[] = ['duel-a', 'duel-b', 'doubles-a', 'doubles-b']

  test.each(fixtures)('in %s it lies inside the stage and off the lanes at every stop', (name) => {
    const misplaced = checkEveryStop(name).filter((check) => !check.isInside || !check.isOffLanes)

    expect(misplaced).toEqual([])
  })

  // on the narrowest stage a few stops leave even the wide card no room clear of both players
  test.each(fixtures)('in %s it leaves the stop’s players clear on a laptop’s stage and wider', (name) => {
    const covering = checkEveryStop(name).filter((check) => check.width >= 780 && !check.isClear)

    expect(covering).toEqual([])
  })
})

describe('the review’s stops', () => {
  test.each(['duel-a', 'duel-b', 'doubles-a', 'doubles-b'] as const)(
    'in %s every player gets the insights’ stops, in order',
    (name) => {
      const insights = readInsights(name)

      for (const { slot } of insights.summary.players) {
        const choices = reviewChoicesOf(insights, slot)
        const listed = insights.reviewStops.filter((stop) => stop.slot === slot)

        expect(choices.map((choice) => choice.label)).toEqual(['Key moments', 'Hits taken', 'Punishes landed', 'KOs'])

        for (const choice of choices) {
          const keys = listed.filter((stop) => stop.scope === choice.key).map((stop) => stop.momentKey)
          const times = choice.stops.map((stop) => stop.timeMs)

          expect(choice.stops.map((stop) => stop.key)).toEqual(keys)
          expect(times).toEqual([...times].sort((left, right) => left - right))
        }
      }
    },
  )
})

describe('where a review stands', () => {
  const stops = readInsights('duel-a').insights.moments.slice(0, 3)
  const first = stops[0]?.timeMs ?? 0
  const heading = { stops, index: 0, isArriving: true, timeMs: first - 2000, isPlaying: true, isOn: true }

  test('heading for a stop, it slows down just before the hit and arrives a few frames after it', () => {
    expect(reviewPhaseOf(heading)).toMatchObject({ hasArrived: false, isEasing: false })
    expect(reviewPhaseOf({ ...heading, timeMs: first - 300 })).toMatchObject({ hasArrived: false, isEasing: true })
    expect(reviewPhaseOf({ ...heading, timeMs: first + 60 })).toMatchObject({ hasArrived: true, isEasing: false })
  })

  test('stopped on it, it explains it, and playing on past it heads for the next', () => {
    const stopped = { ...heading, isArriving: false, isPlaying: false, timeMs: first + 60 }

    expect(reviewPhaseOf(stopped)).toMatchObject({ isStopped: true, hasPlayedOn: false, backIndex: -1 })

    expect(reviewPhaseOf({ ...stopped, isPlaying: true, timeMs: first + 700 })).toMatchObject({
      isStopped: false,
      hasPlayedOn: true,
    })
  })

  test('watching, it never stops', () => {
    expect(reviewPhaseOf({ ...heading, isOn: false, timeMs: first + 60 })).toMatchObject({
      hasArrived: false,
      isStopped: false,
      hasPlayedOn: false,
    })
  })
})

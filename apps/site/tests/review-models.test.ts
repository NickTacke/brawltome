import { describe, expect, test } from 'bun:test'
import { damageText, pointerTimeMs } from '../src/components/match/review/timeline-readout'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import { type Pose, posesAt } from '../src/components/match/stage/pose'
import { tagHeightPx, tagLifts, tagWidthPx } from '../src/components/match/stage/tag-stack'
import { advanceClockMs } from '../src/components/match/stage/use-playback'
import { readInsights, readPlayback } from './match-fixtures'

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

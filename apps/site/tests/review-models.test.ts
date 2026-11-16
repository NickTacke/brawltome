import { describe, expect, test } from 'bun:test'
import { readPlaybackTimeline } from '../src/components/match/stage/playback-timeline'
import { type Pose, posesAt } from '../src/components/match/stage/pose'
import { tagHeightPx, tagLifts, tagWidthPx } from '../src/components/match/stage/tag-stack'
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

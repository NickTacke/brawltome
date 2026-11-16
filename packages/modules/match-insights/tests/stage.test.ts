import { describe, expect, test } from 'bun:test'
import type { LevelLayout } from '@brawltome/contracts'
import { readMatchInsights } from '../index'
import { eventsOf, msOf, type RawEvent } from './derive'
import { isEnemyHit } from './derive-openings'
import { isLiveAt } from './derive-state'
import { readFixtureLine } from './fixtures'
import { fixtures } from './insights'

const layout: LevelLayout = {
  camera: { x: -1000, y: 0, width: 4000, height: 2000 },
  killBounds: { x: -2000, y: -1000, width: 6000, height: 4000 },
  collisions: [{ fromX: 0, fromY: 1000, toX: 2000, toY: 1000, isSoft: false }],
  art: [{ file: 'Platform.png', x: 0, y: 1000, width: 2000, height: 400, rotation: 0 }],
  background: 'Backgrounds.Example.jpg',
}

function isShare(value: number): boolean {
  return value >= 0 && value <= 1
}

describe.each(fixtures())('stage of $name without a layout', (fixture) => {
  const { line } = fixture
  const stage = fixture.insights.insights.stage

  test('has no platforms, art or background, and a box traced from play', () => {
    expect(stage.segments).toEqual([])
    expect(stage.art).toEqual([])
    expect(stage.background).toBeNull()
    expect(stage.isTraced).toBe(true)
    expect(stage.camera).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(stage.aspect).toBeCloseTo(16 / 9, 9)
  })

  test('marks one hit per move that landed on an enemy, inside the box', () => {
    const enemyHits = eventsOf(line, 'hit').filter((hit) => isEnemyHit(line, hit))
    const marked = stage.marks.hits.reduce((total, hit) => total + hit.damage, 0)

    expect(marked).toBeCloseTo(
      enemyHits.reduce((total, hit) => total + (hit.damage ?? 0), 0),
      6,
    )

    expect(stage.marks.hits.every((hit) => isShare(hit.x) && isShare(hit.y))).toBe(true)
  })

  test('marks every KO and every dodge where it happened', () => {
    const kos = eventsOf(line, 'ko')

    expect(stage.marks.kos.map((ko) => [ko.timeMs, ko.victim])).toEqual(
      kos.map((ko) => [msOf(line, ko.step), ko.player as number]),
    )

    for (const trail of stage.marks.dodges) {
      const dodges = eventsOf(line, 'dodge').filter((dodge) => dodge.player === trail.slot)

      expect(trail.spots.map(([timeMs]) => timeMs)).toEqual(dodges.map((dodge) => msOf(line, dodge.step)))
    }
  })

  test('tracks each player every eighth step while in play', () => {
    for (const trail of stage.marks.tracks) {
      let samples = 0

      for (let step = line.timeline.startStep; step < line.timeline.endStep; step += 8) {
        if (isLiveAt(line, trail.slot, step)) samples += 1
      }

      expect(trail.spots).toHaveLength(samples)
    }
  })

  test('carries the clock and the box the playback timeline is drawn in, not the playback itself', () => {
    const every = (line.timeline as unknown as { positions: { every: number } }).positions.every

    expect(stage).not.toHaveProperty('playback')
    expect(stage.sampleMs).toBe(every * line.timeline.stepMs)
    expect(stage.stepMs).toBe(line.timeline.stepMs)
    expect(stage.durationMs).toBe(msOf(line, line.timeline.endStep))
    expect(stage.hasAnimations).toBe(true)
    expect(stage.box.width / stage.box.height).toBeCloseTo(stage.aspect, 9)
  })

  // a share to three decimals, a spot outside the box on its edge
  test('places every hit mark where its first hit landed in the box', () => {
    const { box } = stage
    const share = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 1000
    const hits = eventsOf(line, 'hit') as (RawEvent & { x: number; y: number })[]

    for (const mark of stage.marks.hits) {
      const first = hits.find(
        (hit) => msOf(line, hit.step) === mark.timeMs && hit.attacker === mark.attacker && hit.target === mark.target,
      )

      expect([mark.x, mark.y]).toEqual([
        share(((first?.x ?? Number.NaN) - box.minX) / box.width),
        share(((first?.y ?? Number.NaN) - box.minY) / box.height),
      ])
    }
  })
})

describe('stage with a level layout', () => {
  const insights = readMatchInsights(readFixtureLine('duel-a'), layout)
  const stage = insights?.insights.stage

  test('draws the layout in the camera box', () => {
    expect(stage?.isTraced).toBe(false)
    expect(stage?.aspect).toBe(2)
    expect(stage?.background).toBe('Backgrounds.Example.jpg')
    expect(stage?.camera).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(stage?.segments).toEqual([{ fromX: 0.25, fromY: 0.5, toX: 0.75, toY: 0.5, isSoft: false }])
    expect(stage?.art).toEqual([{ file: 'Platform.png', rotation: 0, x: 0.25, y: 0.5, width: 0.5, height: 0.2 }])
  })

  test('leaves every number that is not about the stage as it was', () => {
    const plain = fixtures().find((fixture) => fixture.name === 'duel-a')?.insights

    expect(insights?.summary).toEqual(plain?.summary as NonNullable<typeof insights>['summary'])

    expect(insights?.insights.punishes).toEqual(
      plain?.insights.punishes as NonNullable<typeof insights>['insights']['punishes'],
    )

    expect(insights?.advantage).toEqual(plain?.advantage as number[])
  })
})

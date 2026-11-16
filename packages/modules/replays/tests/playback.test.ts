import { describe, expect, test } from 'bun:test'
import { trimPlaybackTimeline } from '../playback'
import { insightLine } from './fixtures/insight-lines'

type Timeline = Record<string, unknown> & { state: Record<string, Record<string, unknown>> }

const timeline = (JSON.parse(insightLine()) as { timeline: Timeline }).timeline

describe('trimPlaybackTimeline', () => {
  test('keeps the steps, animations, objects and positions, and drops the events and inputs', () => {
    const trimmed = trimPlaybackTimeline({ timeline })

    expect(Object.keys(trimmed).sort()).toEqual([
      'animations',
      'endStep',
      'objectAnimations',
      'objects',
      'positions',
      'startStep',
      'state',
      'stepMs',
      'stepZeroTime',
    ])

    expect(trimmed.positions).toEqual(timeline.positions as Record<string, unknown>)
    expect(trimmed.objects).toEqual(timeline.objects as unknown[])
    expect(trimmed.stepZeroTime).toBe(timeline.stepZeroTime as number)
  })

  // stocks, hitstun and dodging are what the page's tokens show without art: stocks left above the player and a
  // tint while they're hit or dodging
  test('keeps the state a player is drawn with', () => {
    const trimmed = trimPlaybackTimeline({ timeline })

    expect(Object.keys(trimmed.state)).toEqual(['1', '2'])

    expect(Object.keys(trimmed.state['1'] ?? {}).sort()).toEqual([
      'afterRespawn',
      'airJumpsUsed',
      'animation',
      'damage',
      'dodging',
      'facingRight',
      'hitstun',
      'invulnerable',
      'lastHit',
      'status',
      'stocks',
      'weapon',
    ])

    expect(trimmed.state['1']?.damage).toEqual(timeline.state['1']?.damage)
  })

  test('a line without animations gives empty lists and only the state it has', () => {
    const { animations: _animations, objectAnimations: _objectAnimations, objects: _objects, ...older } = timeline
    const state = { '1': { status: [[0, 'live']], damage: [[0, 0]] } }

    const trimmed = trimPlaybackTimeline({ timeline: { ...older, stepZeroTime: undefined, state } })

    expect(trimmed.animations).toEqual([])
    expect(trimmed.objectAnimations).toEqual([])
    expect(trimmed.objects).toEqual([])
    expect(trimmed.stepZeroTime).toBeNull()
    expect(trimmed.state).toEqual(state)
  })

  test('a line without a timeline is refused', () => {
    expect(() => trimPlaybackTimeline({ format: 1 })).toThrow('trim playback timeline')
  })
})

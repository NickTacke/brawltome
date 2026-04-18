import { describe, expect, test } from 'bun:test'
import { InputFlag } from '@brawltome/replay-format'
import { detectAttackAttempts, directionFromFlags } from '../src/attack-events'

describe('directionFromFlags', () => {
  test('neutral when no direction flags', () => {
    expect(directionFromFlags(0)).toBe('neutral')
  })

  test('Up wins over any horizontal', () => {
    expect(directionFromFlags(InputFlag.AimUp | InputFlag.MoveRight)).toBe('up')
    expect(directionFromFlags(InputFlag.AimUp | InputFlag.MoveLeft)).toBe('up')
  })

  test('Down wins over any horizontal', () => {
    expect(directionFromFlags(InputFlag.Drop | InputFlag.MoveLeft)).toBe('down')
  })

  test('Up beats Down when both are held', () => {
    expect(directionFromFlags(InputFlag.AimUp | InputFlag.Drop)).toBe('up')
  })

  test('side when only horizontal is held', () => {
    expect(directionFromFlags(InputFlag.MoveLeft)).toBe('side')
    expect(directionFromFlags(InputFlag.MoveRight)).toBe('side')
  })

  test('neutral when both horizontals are held (cancel)', () => {
    expect(directionFromFlags(InputFlag.MoveLeft | InputFlag.MoveRight)).toBe('neutral')
  })
})

describe('detectAttackAttempts', () => {
  const common = { tick: 10, ms: 166, entityId: 1, posture: 'air' as const }

  test('edge-trigger emits once on press', () => {
    const events = detectAttackAttempts({
      ...common,
      prevFlags: 0,
      flags: InputFlag.Light,
    })
    expect(events.length).toBe(1)
    expect(events[0].button).toBe('light')
    expect(events[0].direction).toBe('neutral')
    expect(events[0].posture).toBe('air')
  })

  test('holding does not re-emit', () => {
    const events = detectAttackAttempts({
      ...common,
      prevFlags: InputFlag.Light,
      flags: InputFlag.Light,
    })
    expect(events.length).toBe(0)
  })

  test('release does not emit', () => {
    const events = detectAttackAttempts({
      ...common,
      prevFlags: InputFlag.Light,
      flags: 0,
    })
    expect(events.length).toBe(0)
  })

  test('multiple buttons pressed same tick emit one event each', () => {
    const events = detectAttackAttempts({
      ...common,
      prevFlags: 0,
      flags: InputFlag.Light | InputFlag.Heavy,
    })
    expect(events.map((e) => e.button).sort()).toEqual(['heavy', 'light'])
  })

  test('direction context is captured from current flags', () => {
    const events = detectAttackAttempts({
      ...common,
      prevFlags: 0,
      flags: InputFlag.Heavy | InputFlag.MoveRight,
    })
    expect(events.length).toBe(1)
    expect(events[0].direction).toBe('side')
  })

  test('posture is forwarded verbatim', () => {
    const events = detectAttackAttempts({
      ...common,
      posture: 'ground',
      prevFlags: 0,
      flags: InputFlag.DodgeDash,
    })
    expect(events[0].posture).toBe('ground')
    expect(events[0].button).toBe('dodge')
  })

  test('throw is edge-triggered separately from light', () => {
    const events = detectAttackAttempts({
      ...common,
      prevFlags: InputFlag.Light,
      flags: InputFlag.Light | InputFlag.PickUpThrow,
    })
    expect(events.length).toBe(1)
    expect(events[0].button).toBe('throw')
  })
})

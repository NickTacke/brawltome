import { describe, expect, test } from 'bun:test'
import type { Habit } from '@brawltome/contracts'
import { stateSeries, valueAt } from './derive'
import { countedMovement } from './derive-counters'
import { isLiveAt, secondsByPlace, switchesOff } from './derive-state'
import { swingsOf, topShare } from './derive-swings'
import { type Fixture, fixtures, insightOf } from './insights'

// a move as players write it: the weapon, then the move in community notation
const notation = /^[a-z]+( [a-z]+)? ([nsd](light|air|sig|bridge|ender)|rec|gp)$/

function habitOf(habits: Habit[], key: string): Habit {
  const habit = habits.find((entry) => entry.key === key)

  if (!habit) throw new Error(`find habit ${key}: missing`)

  return habit
}

function stunExits(fixture: Fixture, slot: number): number[] {
  const hitstun = stateSeries(fixture.line, slot, 'hitstun')

  return switchesOff(fixture.line, slot, 'hitstun').filter(
    (step) => isLiveAt(fixture.line, slot, step) && !valueAt(hitstun, step + 3, false),
  )
}

function landings(fixture: Fixture, slot: number): number[] {
  const hitstun = stateSeries(fixture.line, slot, 'hitstun')

  return switchesOff(fixture.line, slot, 'inAir').filter(
    (step) => isLiveAt(fixture.line, slot, step) && !valueAt(hitstun, step, false),
  )
}

const cases = fixtures().flatMap((fixture) =>
  fixture.insights.summary.players.map((player) => ({
    fixture,
    slot: player.slot,
    label: `${fixture.name} slot ${player.slot}`,
  })),
)

const habitCases = cases.flatMap(({ fixture, slot, label }) =>
  insightOf(fixture, slot).habits.map((habit) => ({ habit, label: `${label} ${habit.key}` })),
)

describe.each(habitCases)('habit $label', ({ habit }) => {
  test('its options add up to its total, punishes and cost', () => {
    const sum = (pick: (option: Habit['options'][number]) => number) =>
      habit.options.reduce((total, option) => total + pick(option), 0)

    expect(sum((option) => option.count)).toBe(habit.total)

    if (habit.unit === 'seconds') return

    expect(sum((option) => option.punished)).toBe(habit.punished)
    expect(sum((option) => option.costDamage)).toBeCloseTo(habit.costDamage, 6)

    for (const option of habit.options) expect(option.punished).toBeLessThanOrEqual(option.count)
  })

  // a habit counted in seconds is about its first option, so its hits taken are that option's
  test('its top option is the most picked one, at its share', () => {
    if (habit.unit === 'seconds') {
      expect(habit.top).toEqual(habit.options[0] as Habit['options'][number])
      expect(habit.punished).toBe(habit.top?.punished as number)
      expect(habit.costDamage).toBe(habit.top?.costDamage as number)

      return
    }

    const most = Math.max(0, ...habit.options.map((option) => option.count))

    expect(habit.top?.count ?? 0).toBe(most)
    expect(habit.share).toBeCloseTo(habit.total > 0 ? most / habit.total : 0, 9)
  })

  test('every moment names one of its options', () => {
    if (habit.unit === 'seconds') return

    const keys = new Set(habit.options.map((option) => option.key))

    expect(habit.moments).toHaveLength(habit.total)
    expect(habit.moments.every((moment) => keys.has(moment.option))).toBe(true)
  })
})

describe.each(cases)('habits of $label counted again from the events', ({ fixture, slot }) => {
  const habits = insightOf(fixture, slot).habits

  test('swings and signatures that hit or missed', () => {
    const swings = swingsOf(fixture.line, slot)
    const landed = swings.filter((swing) => swing.isLanded).length
    const signatures = swings.filter((swing) => swing.attack.signature)
    const signaturesLanded = signatures.filter((swing) => swing.isLanded).length

    expect(habitOf(habits, 'swings').total).toBe(swings.length)
    expect(habitOf(habits, 'swings').share).toBeCloseTo(topShare(landed, swings.length - landed) ?? 0, 9)
    expect(habitOf(habits, 'signatures').total).toBe(signatures.length)

    expect(habitOf(habits, 'signatures').share).toBeCloseTo(
      topShare(signaturesLanded, signatures.length - signaturesLanded) ?? 0,
      9,
    )
  })

  test('seconds in the air, on the ground and on a wall', () => {
    const air = habitOf(habits, 'air')
    const seconds = secondsByPlace(fixture.line, slot)
    const countOf = (key: string) => air.options.find((option) => option.key === key)?.count

    expect(countOf('air')).toBe(seconds.air)
    expect(countOf('ground')).toBe(seconds.ground)
    expect(countOf('wall')).toBe(seconds.wall)
    expect(air.share).toBeCloseTo(seconds.air / (seconds.air + seconds.ground + seconds.wall), 9)
  })

  test('the moments each reaction habit starts from', () => {
    const dodgeEnds = switchesOff(fixture.line, slot, 'dodging').filter((step) => isLiveAt(fixture.line, slot, step))

    expect(habitOf(habits, 'after-hit').total).toBe(stunExits(fixture, slot).length)
    expect(habitOf(habits, 'landing').total).toBe(landings(fixture, slot).length)
    expect(habitOf(habits, 'after-dodge').total).toBe(dodgeEnds.length)
  })

  test('dodges by timing and direction', () => {
    const counted = countedMovement(fixture.line, slot)
    const timing = habitOf(habits, 'dodge-timing')

    expect(timing.total).toBe(counted.dodges)
    expect(timing.options.find((option) => option.key === 'chase')?.count).toBe(counted.chaseDodges)
    expect(habitOf(habits, 'dodge-direction').total).toBeLessThanOrEqual(counted.dodges - counted.chaseDodges)
    expect(habitOf(habits, 'dodge-after-hit').total).toBeLessThanOrEqual(habitOf(habits, 'dodge-direction').total)
  })

  test('the first thing done after each hit, landing and dodge', () => {
    const dodgeEnds = switchesOff(fixture.line, slot, 'dodging').filter((step) => isLiveAt(fixture.line, slot, step))

    const situations: [string, number[], number][] = [
      ['after-hit', stunExits(fixture, slot), 10],
      ['landing', landings(fixture, slot), 8],
      ['after-dodge', dodgeEnds, 10],
    ]

    for (const [key, steps, windowSteps] of situations) {
      const counts = new Map<string, number>()

      for (const step of steps) {
        const reaction = fixture.line.timeline.events.find(
          (event) =>
            event.player === slot &&
            event.step >= step &&
            event.step <= step + windowSteps &&
            ['attack', 'dodge', 'jump', 'dash'].includes(event.type),
        )

        counts.set(reaction?.type ?? 'none', (counts.get(reaction?.type ?? 'none') ?? 0) + 1)
      }

      for (const option of habitOf(habits, key).options) expect(option.count).toBe(counts.get(option.key) ?? 0)
    }
  })

  // a dodge with no left or right in it is never left out, as it needs no enemy to be towards or away from
  test('dodges straight up, down or on the spot sit in the middle column', () => {
    const counted = fixture.line.timeline.events.filter(
      (event) =>
        event.type === 'dodge' &&
        event.player === slot &&
        !String(event.kind).startsWith('Fast') &&
        !/left|right/.test(event.direction ?? ''),
    )

    const pad = habitOf(habits, 'dodge-direction').options
    const middle = pad.filter((option) => option.key.endsWith('-none'))
    const byRow = (row: string) => middle.find((option) => option.key === `${row}-none`)?.count

    expect(byRow('up')).toBe(counted.filter((event) => event.direction?.includes('up')).length)
    expect(byRow('down')).toBe(counted.filter((event) => event.direction?.includes('down')).length)
    expect(byRow('mid')).toBe(counted.filter((event) => !event.direction).length)
  })

  test('first swings are written in community notation', () => {
    const opener = habitOf(habits, 'opener')

    for (const option of opener.options) expect(option.label).toMatch(notation)
  })
})

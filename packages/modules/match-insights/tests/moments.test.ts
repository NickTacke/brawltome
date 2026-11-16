import { describe, expect, test } from 'bun:test'
import type { Moment, ReviewScope } from '@brawltome/contracts'
import { msOf } from './derive'
import { fixtures } from './insights'

// a KO below this damage came early; a punish from this damage up is a big one
const earlyKoDamage = 100
const bigDamage = 30

function expectedClass(moment: Moment): Moment['class'] {
  if (!moment.lead) return moment.knockout?.isByTeammate ? 'team-ko' : 'fall'

  if (moment.knockout) return moment.knockout.damage < earlyKoDamage ? 'early-ko' : 'ko'

  return moment.damage >= bigDamage ? 'big' : moment.lead.kind
}

function isInScope(moment: Moment, slot: number, scope: ReviewScope): boolean {
  if (scope === 'taken') return moment.victim === slot

  if (scope === 'dealt') return moment.attacker === slot

  if (scope === 'kos') return moment.knockout !== null

  const isInvolved = moment.victim === slot || moment.attacker === slot

  return isInvolved && (moment.knockout !== null || moment.damage >= bigDamage)
}

describe.each(fixtures())('moments of $name', (fixture) => {
  const { punishes, moments, knockouts } = fixture.insights.insights
  const durationMs = fixture.insights.summary.durationMs

  test('one moment per punish, with its players, time and damage', () => {
    for (const [index, punish] of punishes.entries()) {
      const moment = moments.find((entry) => entry.key === `punish-${index}`)

      expect(moment).toMatchObject({
        attacker: punish.attacker,
        victim: punish.target,
        timeMs: punish.startMs,
        damage: punish.damage,
      })
    }
  })

  test('one moment per KO no punish led to, and every KO a punish led to is on it', () => {
    const falls = moments.filter((moment) => moment.lead === null)

    expect(falls).toHaveLength(knockouts.filter((knockout) => knockout.punishIndex === null).length)

    for (const knockout of knockouts) {
      if (knockout.punishIndex === null) continue

      const punish = punishes[knockout.punishIndex]

      expect(punish?.isKo).toBe(true)
      expect(punish?.target).toBe(knockout.victim)
      expect(punish?.attacker).toBe(knockout.killer as number)
      expect(moments.find((moment) => moment.key === `punish-${knockout.punishIndex}`)?.knockout).toEqual(knockout)
    }
  })

  test('are unique, in time order and inside the match', () => {
    const times = moments.map((moment) => moment.timeMs)

    expect(new Set(moments.map((moment) => moment.key)).size).toBe(moments.length)
    expect(times).toEqual([...times].sort((left, right) => left - right))
    expect(moments.every((moment) => moment.timeMs <= moment.endMs && moment.endMs <= durationMs)).toBe(true)
  })

  test('each has the class its rules give it', () => {
    for (const moment of moments) expect(moment.class).toBe(expectedClass(moment))
  })

  test('first blood is the first KO', () => {
    const first = fixture.line.timeline.events.find((event) => event.type === 'ko')

    expect(fixture.insights.insights.firstBloodMs).toBe(first ? msOf(fixture.line, first.step) : null)
  })
})

describe.each(fixtures())('review stops of $name', (fixture) => {
  const { moments } = fixture.insights.insights
  const stops = fixture.insights.reviewStops
  const durationMs = fixture.insights.summary.durationMs

  test('every stop sits inside the match, on an existing moment', () => {
    for (const stop of stops) {
      const moment = moments.find((entry) => entry.key === stop.momentKey)

      expect(stop.timeMs).toBeGreaterThanOrEqual(0)
      expect(stop.timeMs).toBeLessThanOrEqual(durationMs)
      expect(moment?.timeMs).toBe(stop.timeMs)
    }
  })

  test('each player and scope stops at exactly the moments its rule picks, in order', () => {
    for (const player of fixture.insights.summary.players) {
      for (const scope of ['key', 'taken', 'dealt', 'kos'] as const) {
        const picked = stops.filter((stop) => stop.slot === player.slot && stop.scope === scope)
        const expected = moments.filter((moment) => isInScope(moment, player.slot, scope))

        expect(picked.map((stop) => stop.momentKey)).toEqual(expected.map((moment) => moment.key))
      }
    }
  })
})

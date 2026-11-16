import { describe, expect, test } from 'bun:test'
import { areEnemies, eventsOf, msOf, sumDamage } from './derive'
import { damageBefore, endsInKo, hitsWithin, isEnemyHit, swingCount } from './derive-openings'
import { fixtures } from './insights'

const cases = fixtures().flatMap((fixture) =>
  fixture.insights.insights.punishes.map((punish, index) => ({
    fixture,
    punish,
    label: `${fixture.name} punish ${index}`,
  })),
)

describe.each(fixtures())('openings of $name', (fixture) => {
  const punishes = fixture.insights.insights.punishes

  test('every enemy hit with a swing or throw behind it belongs to a punish', () => {
    const enemyHits = eventsOf(fixture.line, 'hit').filter((hit) => isEnemyHit(fixture.line, hit))
    const punished = punishes.reduce((total, punish) => total + punish.damage, 0)

    expect(punished).toBeCloseTo(sumDamage(enemyHits), 6)
  })

  test('punishes are in the order they began', () => {
    const starts = punishes.map((punish) => punish.startStep)

    expect(starts).toEqual([...starts].sort((left, right) => left - right))
  })
})

describe.each(cases)('$label', ({ fixture, punish }) => {
  const spans = fixture.insights.insights.punishes
  const hits = hitsWithin(fixture.line, punish)

  test('is between enemies and starts and ends at its steps', () => {
    expect(areEnemies(fixture.line, punish.attacker, punish.target)).toBe(true)
    expect(punish.startMs).toBe(msOf(fixture.line, punish.startStep))
    expect(punish.endMs).toBe(msOf(fixture.line, punish.endStep))
    expect(punish.hits[0]?.offsetMs).toBe(0)
  })

  test('has the damage and swings of the hit events between its steps', () => {
    expect(punish.damage).toBeCloseTo(sumDamage(hits), 6)
    expect(punish.hits.reduce((total, hit) => total + hit.damage, 0)).toBeCloseTo(punish.damage, 6)
    expect(punish.hits).toHaveLength(swingCount(fixture.line, hits))
  })

  test('starts from the damage the target had and ends in a KO only when it led to one', () => {
    expect(punish.targetDamageFrom).toBe(damageBefore(fixture.line, punish))
    expect(punish.isKo).toBe(endsInKo(fixture.line, punish, spans))
  })
})

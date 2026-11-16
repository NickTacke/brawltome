import { describe, expect, test } from 'bun:test'
import { areEnemies, eventsOf, msOf, sumDamage } from './derive'
import { damageBefore, endsInKo, hitsWithin, isEnemyHit, resetSteps, swingCount } from './derive-openings'
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

  test('every enemy hit lies in exactly one punish of its pair', () => {
    for (const hit of eventsOf(fixture.line, 'hit').filter((event) => isEnemyHit(fixture.line, event))) {
      const holding = punishes.filter(
        (punish) =>
          punish.attacker === hit.attacker &&
          punish.target === hit.target &&
          punish.startStep <= hit.step &&
          hit.step <= punish.endStep,
      )

      expect(holding).toHaveLength(1)
    }
  })

  // a punish ends when the attacker goes the reset gap without a hit on the target, or is hit themselves
  test('two punishes of one pair are apart by more than the gap, or the attacker was hit in between', () => {
    const hits = eventsOf(fixture.line, 'hit').filter((event) => isEnemyHit(fixture.line, event))

    for (const [index, punish] of punishes.entries()) {
      const next = punishes
        .slice(index + 1)
        .find((other) => other.attacker === punish.attacker && other.target === punish.target)

      if (!next) continue

      const wasHit = hits.some(
        (hit) => hit.target === punish.attacker && hit.step >= punish.startStep && hit.step <= next.startStep,
      )

      expect(next.startStep - punish.endStep > resetSteps || wasHit).toBe(true)
    }
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

  test('runs from its first hit to its last, with no gap longer than the reset gap', () => {
    const steps = hits.map((hit) => hit.step).sort((left, right) => left - right)

    expect(steps[0]).toBe(punish.startStep)
    expect(steps.at(-1)).toBe(punish.endStep)

    for (const [index, step] of steps.slice(1).entries()) {
      expect(step - (steps[index] ?? step)).toBeLessThanOrEqual(resetSteps)
    }
  })

  test('starts from the damage the target had and ends in a KO only when it led to one', () => {
    expect(punish.targetDamageFrom).toBe(damageBefore(fixture.line, punish))
    expect(punish.isKo).toBe(endsInKo(fixture.line, punish, spans))
  })
})

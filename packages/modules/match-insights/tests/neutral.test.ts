import { describe, expect, test } from 'bun:test'
import { sumDamage } from './derive'
import { damageBefore, endsInKo, hitsWithin, swingCount } from './derive-openings'
import { type Fixture, fixtures, insightOf } from './insights'

// from here on the game draws a player's damage in red
const killDamage = 150

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function derivedNeutral(fixture: Fixture, slot: number) {
  const { line } = fixture
  const spans = fixture.insights.insights.punishes
  const won = spans.filter((punish) => punish.attacker === slot)
  const lost = spans.filter((punish) => punish.target === slot)
  const damages = won.map((punish) => sumDamage(hitsWithin(line, punish)))
  const strings = won.map((punish) => swingCount(line, hitsWithin(line, punish)))
  const kos = won.filter((punish) => endsInKo(line, punish, spans)).length
  const chances = won.filter((punish) => damageBefore(line, punish) >= killDamage)

  return {
    openingsWon: won.length,
    openingsLost: lost.length,
    damagePerOpening: mean(damages),
    hitsPerOpening: mean(strings),
    longestString: Math.max(0, ...strings),
    biggestPunish: Math.max(0, ...damages),
    openingsPerKo: kos > 0 ? won.length / kos : null,
    killChances: chances.length,
    killConversions: chances.filter((punish) => endsInKo(line, punish, spans)).length,
  }
}

const cases = fixtures().flatMap((fixture) =>
  fixture.insights.summary.players.map((player) => ({
    fixture,
    slot: player.slot,
    label: `${fixture.name} slot ${player.slot}`,
  })),
)

describe.each(cases)('neutral of $label', ({ fixture, slot }) => {
  const neutral = insightOf(fixture, slot).neutral
  const expected = derivedNeutral(fixture, slot)

  test('openings won and lost', () => {
    expect(neutral.openingsWon).toBe(expected.openingsWon)
    expect(neutral.openingsLost).toBe(expected.openingsLost)
  })

  test('damage and hits per opening, the longest string and the biggest punish', () => {
    expect(neutral.damagePerOpening).toBeCloseTo(expected.damagePerOpening, 6)
    expect(neutral.hitsPerOpening).toBeCloseTo(expected.hitsPerOpening, 6)
    expect(neutral.longestString).toBe(expected.longestString)
    expect(neutral.biggestPunish).toBeCloseTo(expected.biggestPunish, 6)
  })

  test('kill chances, conversions and openings per KO', () => {
    expect(neutral.killChances).toBe(expected.killChances)
    expect(neutral.killConversions).toBe(expected.killConversions)

    if (expected.openingsPerKo === null) expect(neutral.openingsPerKo).toBeNull()
    else expect(neutral.openingsPerKo).toBeCloseTo(expected.openingsPerKo, 6)
  })

  test('the causes add up to the openings and their damage', () => {
    const won = neutral.causes.reduce((total, cause) => total + cause.won, 0)
    const lost = neutral.causes.reduce((total, cause) => total + cause.lost, 0)
    const damageWon = neutral.causes.reduce((total, cause) => total + cause.damageWon, 0)

    expect(won).toBe(expected.openingsWon)
    expect(lost).toBe(expected.openingsLost)
    expect(damageWon).toBeCloseTo(expected.damagePerOpening * expected.openingsWon, 6)
  })

  test('the openings by how they began add up to the openings and their damage', () => {
    const moments = fixture.insights.insights.moments.filter((moment) => moment.lead !== null)
    const won = moments.filter((moment) => moment.attacker === slot)
    const lost = moments.filter((moment) => moment.victim === slot)
    const damageWon = won.reduce((total, moment) => total + moment.damage, 0)

    expect(won).toHaveLength(expected.openingsWon)
    expect(lost).toHaveLength(expected.openingsLost)
    expect(damageWon).toBeCloseTo(expected.damagePerOpening * expected.openingsWon, 6)
  })
})

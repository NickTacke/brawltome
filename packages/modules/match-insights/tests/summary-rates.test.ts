import { describe, expect, test } from 'bun:test'
import { eventsOf, msOf, sideOf, stateSeries, statsOf, sumDamage } from './derive'
import { longestAirMs, pressesOf } from './derive-state'
import { type Fixture, fixtures, insightOf } from './insights'

// the rates, shares and odd counts beside the game's counters

function playerOf(fixture: Fixture, slot: number) {
  const player = fixture.insights.summary.players.find((entry) => entry.slot === slot)

  if (!player) throw new Error(`find summary player ${slot} in ${fixture.name}: missing`)

  return player
}

function extrasOf(fixture: Fixture, slot: number) {
  const extras = fixture.insights.extras.players.find((entry) => entry.slot === slot)

  if (!extras) throw new Error(`find extras for ${slot} in ${fixture.name}: missing`)

  return extras
}

const cases = fixtures().flatMap((fixture) =>
  fixture.insights.summary.players.map((player) => ({
    fixture,
    slot: player.slot,
    label: `${fixture.name} slot ${player.slot}`,
  })),
)

describe.each(cases)('rates and shares of $label', ({ fixture, slot }) => {
  const player = playerOf(fixture, slot)
  const stats = statsOf(fixture.line, slot) as Record<string, number>
  const minutes = fixture.line.stats.GameDuration / 60_000

  test('per fall, per minute and the share of time in each place come from the counters', () => {
    const timeTotal = stats.TimeInAir + stats.TimeOnGround + stats.TimeOnWall

    expect(player.damageTakenPerFall).toBe(stats.Deaths > 0 ? stats.DamageTaken / stats.Deaths : null)
    expect(player.damagePerMinute).toBeCloseTo(stats.DamageDealt / minutes, 9)
    expect(player.dodgesPerMinute).toBeCloseTo(player.dodges / minutes, 9)
    expect(player.airShare).toBeCloseTo(stats.TimeInAir / timeTotal, 9)
    expect(player.groundShare).toBeCloseTo(stats.TimeOnGround / timeTotal, 9)
    expect(player.wallShare).toBeCloseTo(stats.TimeOnWall / timeTotal, 9)
  })

  test('dodges by direction are the dodge events, a dodge without one on the spot', () => {
    const directions: Record<string, number> = {}

    for (const dodge of eventsOf(fixture.line, 'dodge').filter((event) => event.player === slot)) {
      const direction = (dodge as { direction?: string }).direction || 'spot'

      directions[direction] = (directions[direction] ?? 0) + 1
    }

    expect(player.dodgeDirections).toEqual(directions)
  })

  test('inputs, mashing and airtime are counted from the input and state', () => {
    const presses = pressesOf(fixture.line, slot)
    const oddities = insightOf(fixture, slot).oddities

    expect(extrasOf(fixture, slot).inputsPerMinute).toBeCloseTo(presses.presses / minutes, 9)
    expect(oddities.mashPerSecond).toBeCloseTo(presses.stunnedPresses / presses.stunnedSeconds, 9)
    expect(oddities.longestAirMs).toBe(longestAirMs(fixture.line, slot))
  })

  // the game's team counters also count a player's damage on themselves, like their own mine going off
  test('damage on teammates is the hits on them, and the game team counter less self damage', () => {
    const hits = eventsOf(fixture.line, 'hit')

    const selfDamage = (player: number) =>
      sumDamage(hits.filter((hit) => hit.attacker === player && hit.target === player))

    const friendly = hits.filter(
      (hit) =>
        hit.attacker === slot &&
        hit.target !== slot &&
        sideOf(fixture.line, hit.target ?? 0) === sideOf(fixture.line, slot),
    )

    const friendlyDamage = insightOf(fixture, slot).oddities.friendlyDamage

    expect(friendlyDamage).toBeCloseTo(sumDamage(friendly), 9)

    if (!fixture.line.match.rules.hasTeams) return

    expect(Math.abs(friendlyDamage + selfDamage(slot) - stats.TeamDamageDealt)).toBeLessThanOrEqual(0.1)
  })

  test('the weapon held over time and the loadout are what the line says', () => {
    const extras = extrasOf(fixture, slot)
    const loadout = statsOf(fixture.line, slot).Loadout as Record<string, string | undefined>
    const weapons = stateSeries(fixture.line, slot, 'weapon')

    expect(extras.weaponSeries).toEqual(
      weapons.map(([step, weapon]): [number, string] => [msOf(fixture.line, step), weapon as string]),
    )

    expect(extras.skin).toBe(loadout.SkinName ?? '')
    expect(extras.colour).toBe(loadout.ColorSchemeName ?? '')
    expect(extras.stanceKey).toBe(loadout.Stance ?? '')
    expect(extras.sidekick).toBe(loadout.SidekickName ?? '')
    expect(extras.koEffect).toBe(loadout.KOEffectName ?? '')
  })
})

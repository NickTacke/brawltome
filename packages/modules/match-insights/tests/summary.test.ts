import { describe, expect, test } from 'bun:test'
import { matchInsightsSchema } from '@brawltome/contracts'
import { enemyHits, enemyKos, eventsOf, fallsOf, msOf, sideOf, statsOf, sumDamage, winningSides } from './derive'
import { countedGravityCancels, countedMovement, countedMoves, countedWeapons } from './derive-counters'
import { swingsOf, thrownHits } from './derive-swings'
import { countedUses } from './derive-uses'
import { type Fixture, fixtures, insightOf } from './insights'

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

describe.each(fixtures())('match summary of $name', (fixture) => {
  test('has the shape the contract describes', () => {
    expect(() => matchInsightsSchema.parse(fixture.insights)).not.toThrow()
  })

  test('lasts as long as the game says', () => {
    expect(fixture.insights.summary.durationMs).toBe(fixture.line.stats.GameDuration)
  })

  test('lists every KO the timeline records, at its time and damage', () => {
    const kos = eventsOf(fixture.line, 'ko').map((event) => ({
      timeMs: msOf(fixture.line, event.step),
      victim: event.player as number,
      killer: event.killer ?? null,
      damage: event.damage as number,
    }))

    expect(fixture.insights.summary.kos).toEqual(kos)

    expect(
      fixture.insights.insights.knockouts.map(({ timeMs, victim, killer, damage }) => ({
        timeMs,
        victim,
        killer,
        damage,
      })),
    ).toEqual(kos)
  })
})

describe.each(cases)('player numbers of $label', ({ fixture, slot }) => {
  const player = playerOf(fixture, slot)
  const stats = statsOf(fixture.line, slot)

  test('score, KOs, falls and damage are the game counters and agree with the events', () => {
    expect(player.score).toBe((stats.Score as number | undefined) ?? null)
    expect(player.kos).toBe(stats.KOs as number)
    expect(player.kos).toBe(enemyKos(fixture.line, slot))
    expect(player.falls).toBe(stats.Deaths as number)
    expect(player.falls).toBe(fallsOf(fixture.line, slot).length)
    expect(player.damageDealt).toBe(stats.DamageDealt as number)
    expect(Math.abs(player.damageDealt - sumDamage(enemyHits(fixture.line, slot)))).toBeLessThanOrEqual(1)
    expect(player.damageTaken).toBe(stats.DamageTaken as number)
  })

  test('side, stocks left and the result follow the falls', () => {
    const side = sideOf(fixture.line, slot)
    const stocks = fixture.line.match.rules.stocks

    expect(player.side).toBe(side)
    expect(player.stocksLeft).toBe(Math.max(0, stocks - fallsOf(fixture.line, slot).length))
    expect(player.isWinner).toBe(winningSides(fixture.line).has(side))
  })

  test('every move row is one of the game counters, most damage first', () => {
    const counted = countedMoves(fixture.line, slot)

    expect(player.moves).toHaveLength(counted.length)

    for (const move of player.moves) {
      const expected = counted.find((entry) => entry.key === move.key)

      expect(move).not.toHaveProperty('hits')

      expect({ key: move.key, uses: move.uses, damage: move.damage, kos: move.kos }).toEqual({
        key: expected?.key as string,
        uses: expected?.uses as number,
        damage: expected?.damage as number,
        kos: expected?.kos as number,
      })
    }

    const damages = player.moves.map((move) => move.damage)

    expect(damages).toEqual([...damages].sort((left, right) => right - left))
    expect(player).not.toHaveProperty('attacks')
    expect(player).not.toHaveProperty('hits')
  })

  // the uses counted from the events match the game's own counter for every move, which proves the events are keyed
  // right; the uses that landed then come from the same events
  test('every move row has the uses that landed, from the events', () => {
    const counted = countedUses(fixture.line, slot)

    for (const move of player.moves) {
      expect(counted.get(move.key)?.uses ?? 0).toBe(move.uses)
      expect(move.usesLanded).toBe(counted.get(move.key)?.landed ?? 0)
      expect(move.usesLanded).toBeLessThanOrEqual(move.uses)
    }

    const swings = player.moves.filter((move) => !move.key.endsWith('.Throw'))
    const oddities = insightOf(fixture, slot).oddities

    expect(swings.reduce((total, move) => total + move.uses, 0)).toBe(oddities.swings)
    expect(swings.reduce((total, move) => total + move.usesLanded, 0)).toBe(oddities.swingsHit)
  })

  test('every weapon row has the time held and damage of its counters, most held first', () => {
    const counted = countedWeapons(fixture.line, slot)

    expect(player.weapons).toHaveLength(counted.length)

    for (const weapon of player.weapons) {
      expect({ weapon: weapon.weapon, heldMs: weapon.heldMs, damage: weapon.damage }).toEqual(
        counted.find((entry) => entry.weapon === weapon.weapon) as (typeof counted)[number],
      )
    }

    const held = player.weapons.map((weapon) => weapon.heldMs)

    expect(held).toEqual([...held].sort((left, right) => right - left))
  })

  test('movement is the game counters and the events counted', () => {
    const extras = extrasOf(fixture, slot)
    const counted = countedMovement(fixture.line, slot)

    expect(extras.dashes).toBe(counted.dashes)
    expect(extras.jumps).toBe(counted.jumps)
    expect(extras.airJumps).toBe(counted.airJumps)
    expect(extras.dashJumps).toBe(counted.dashJumps)
    expect(extras.clashes).toBe(counted.clashes)
    expect(extras.suicides).toBe(counted.suicides)
    expect(extras.pickups).toBe(counted.pickups)
    expect(extras.throws).toBe(counted.throws)
    expect(extras.spotDodges).toBe(counted.spotDodges)
    expect(player.dodges).toBe(counted.dodges)
  })

  test('accuracy and the odd counts agree with the events', () => {
    const oddities = insightOf(fixture, slot).oddities
    const swings = swingsOf(fixture.line, slot)
    const counted = countedMovement(fixture.line, slot)

    expect(oddities.swings).toBe(swings.length)
    expect(oddities.swingsHit).toBe(swings.filter((swing) => swing.isLanded).length)
    expect(oddities.chaseDodges).toBe(counted.chaseDodges)
    expect(oddities.gravityCancels).toBe(countedGravityCancels(fixture.line, slot))

    expect(oddities.throwsHit).toBe(
      new Set(thrownHits(fixture.line, slot).map((hit) => `${hit.step}${hit.weapon}`)).size,
    )
  })
})

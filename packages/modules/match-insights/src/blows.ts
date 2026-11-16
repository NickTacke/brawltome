import type { Strike } from './strikes'

// one strike's damage on one target: a multi-hit move that caught two players is two blows

export type Blow = {
  attacker: number
  target: number
  step: number
  lastStep: number
  weapon: string
  move: string
  damage: number
  isThrow: boolean
}

function blowsOfStrike(strike: Strike): Blow[] {
  const targets = new Set(strike.hits.map((hit) => hit.target))

  return [...targets].map((target) => {
    const hits = strike.hits.filter((hit) => hit.target === target)

    return {
      attacker: strike.attacker,
      target,
      step: hits[0]?.step ?? strike.step,
      lastStep: hits.at(-1)?.step ?? strike.step,
      weapon: strike.weapon,
      move: strike.move,
      damage: hits.reduce((total, hit) => total + hit.damage, 0),
      isThrow: strike.isThrow,
    }
  })
}

/** Every blow of the match, in the order their first hits landed. */
export function readBlows(strikes: Strike[]): Blow[] {
  return strikes.flatMap(blowsOfStrike).sort((left, right) => left.step - right.step)
}

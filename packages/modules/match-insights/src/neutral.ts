import { type CauseRecord, type NeutralStats, type Punish, punishCauses } from '@brawltome/contracts'
import type { MatchFacts } from './facts'
import { causeLabels } from './punish-cause'

// a player's neutral and punish game, counted over the match's punishes

// from here on the game draws a player's damage in red
const killDamage = 150

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function damageOf(punishes: Punish[]): number {
  return punishes.reduce((total, punish) => total + punish.damage, 0)
}

function causeRecords(won: Punish[], lost: Punish[]): CauseRecord[] {
  return punishCauses.map((cause) => {
    const wonHere = won.filter((punish) => punish.cause === cause)
    const lostHere = lost.filter((punish) => punish.cause === cause)

    return {
      cause,
      label: causeLabels[cause],
      won: wonHere.length,
      lost: lostHere.length,
      damageWon: damageOf(wonHere),
      damageLost: damageOf(lostHere),
    }
  })
}

function trueLinkShare(punishes: Punish[]): number | null {
  const links = punishes.flatMap((punish) => punish.hits.slice(1))

  return links.length > 0 ? links.filter((hit) => hit.isTrue).length / links.length : null
}

export function readNeutral(facts: MatchFacts, slot: number): NeutralStats {
  const won = facts.punishes.filter((punish) => punish.attacker === slot)
  const lost = facts.punishes.filter((punish) => punish.target === slot)
  const kos = won.filter((punish) => punish.isKo).length
  const killChances = won.filter((punish) => punish.targetDamageFrom >= killDamage)

  return {
    openingsWon: won.length,
    openingsLost: lost.length,
    damagePerOpening: mean(won.map((punish) => punish.damage)),
    hitsPerOpening: mean(won.map((punish) => punish.hits.length)),
    longestString: Math.max(0, ...won.map((punish) => punish.hits.length)),
    biggestPunish: Math.max(0, ...won.map((punish) => punish.damage)),
    openingsPerKo: kos > 0 ? won.length / kos : null,
    trueLinkShare: trueLinkShare(won),
    killChances: killChances.length,
    killConversions: killChances.filter((punish) => punish.isKo).length,
    timesReversed: won.filter((punish) => punish.wasReversed).length,
    causes: causeRecords(won, lost),
  }
}

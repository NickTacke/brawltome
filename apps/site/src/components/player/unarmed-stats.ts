import { type CareerLegend, emptyWeaponStats, type WeaponStats } from './weapon-stats'

function sum(legends: CareerLegend[], amountOf: (legend: CareerLegend) => number): number {
  return legends.reduce((total, legend) => total + amountOf(legend), 0)
}

// the api has no unarmed time, so it's whatever match time no weapon was held for
export function unarmedStats(legends: CareerLegend[]): WeaponStats {
  const matchTime = sum(legends, (legend) => legend.matchTime)
  const heldTime = sum(legends, (legend) => legend.weaponOne.heldTime + legend.weaponTwo.heldTime)

  return {
    ...emptyWeaponStats('Unarmed'),
    legendCount: legends.filter((legend) => legend.games > 0).length,
    timeHeld: Math.max(matchTime - heldTime, 0),
    KOs: sum(legends, (legend) => legend.unarmed.kos),
    damage: sum(legends, (legend) => Number(legend.unarmed.damage)),
  }
}

import type { MoveRow, WeaponRow } from '@brawltome/contracts'
import { counterKeyOf, counterLabel } from './move-names'
import type { PlayerStats } from './player-stats'
import type { Strike } from './strikes'
import { isRealWeapon, weaponLabel } from './weapon-names'

// the game's counters per weapon and per move, as rows: weapons most held first, moves most damage first. the game
// counts a multi-hit move's every hit, so the uses that landed come from the player's own strikes instead

// a throw lands when it hits; any other use when the swing hit an enemy
function isLandedUse(strike: Strike, weapon: string, key: string): boolean {
  if (strike.weapon !== weapon || strike.hits.length === 0) return false

  if (key === 'Throw') return strike.isThrow

  return !strike.isThrow && counterKeyOf(strike.move) === key
}

export function readMoveRows(stats: PlayerStats, strikes: Strike[]): MoveRow[] {
  const rows = stats.weapons.flatMap(({ weapon, moves }) =>
    moves.map(
      ([key, counters]): MoveRow => ({
        key: `${weapon}.${key}`,
        label: counterLabel(key),
        weapon,
        uses: counters.Uses,
        usesLanded: strikes.filter((strike) => isLandedUse(strike, weapon, key)).length,
        damage: counters.EnemyDamage,
        kos: counters.EnemyKOs,
        gravityCancels: counters.GCUses,
      }),
    ),
  )

  return rows.sort((left, right) => right.damage - left.damage)
}

export function readWeaponRows(stats: PlayerStats): WeaponRow[] {
  const rows = stats.weapons.map(
    ({ weapon, heldMs, moves }): WeaponRow => ({
      weapon,
      label: weaponLabel(weapon),
      isWeapon: isRealWeapon(weapon),
      heldMs,
      damage: moves.reduce((total, [, counters]) => total + counters.EnemyDamage, 0),
    }),
  )

  return rows.sort((left, right) => right.heldMs - left.heldMs)
}

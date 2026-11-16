import type { MoveRow, WeaponRow } from '@brawltome/contracts'
import { counterLabel } from './move-names'
import type { PlayerStats } from './player-stats'
import { isRealWeapon, weaponLabel } from './weapon-names'

// the game's counters per weapon and per move, as rows: weapons most held first, moves most damage first

export function readMoveRows(stats: PlayerStats): MoveRow[] {
  const rows = stats.weapons.flatMap(({ weapon, moves }) =>
    moves.map(
      ([key, counters]): MoveRow => ({
        key: `${weapon}.${key}`,
        label: counterLabel(key),
        weapon,
        uses: counters.Uses,
        hits: counters.EnemyHits,
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

import type { WeaponRow } from '@brawltome/contracts'
import { formatClock, formatDamage } from '../match-format'
import { weaponImageUrl } from './weapon-image'

/** A weapon a player held: the damage its moves did, and how long they held it. */
export function WeaponFigure({ weapon }: { weapon: WeaponRow }) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={`${weapon.label}, held ${formatClock(weapon.heldMs)}`}>
      <img src={weaponImageUrl(weapon.weapon)} alt="" className="size-8 shrink-0 object-contain" />
      <div className="min-w-0 leading-tight">
        <div className="font-black tracking-tight text-strong tabular-nums">{formatDamage(weapon.damage)}</div>
        <div className="text-xs text-soft tabular-nums">{formatClock(weapon.heldMs)}</div>
      </div>
    </div>
  )
}

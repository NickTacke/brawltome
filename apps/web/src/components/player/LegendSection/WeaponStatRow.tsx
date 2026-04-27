import { formatNum } from '@/lib/utils'
import { formatCompact, formatHours, getWeaponIcon } from '../shared'
import { computeWeaponStats } from './utils'

export interface WeaponStatRowProps {
  name: string
  kos: number
  dmg: number
  time: number
  totalKOs: number
  totalDmg: number
  totalTime: number
}

export function WeaponStatRow({ name, kos, dmg, time, totalKOs, totalDmg, totalTime }: WeaponStatRowProps) {
  const kosPercent = totalKOs > 0 ? (kos / totalKOs) * 100 : 0
  const dmgPercent = totalDmg > 0 ? (dmg / totalDmg) * 100 : 0
  const timePercent = totalTime > 0 ? (time / totalTime) * 100 : 0
  const { dps, timeToKill } = computeWeaponStats({ time, dmg, kos })

  return (
    <div className="p-3 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <img src={getWeaponIcon(name)} alt={name} className="h-6 w-6 object-contain" />
        <span className="text-xs font-bold text-foreground uppercase">{name}</span>
      </div>

      <div className="space-y-2 text-[11px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">KOs</span>
          <span className="font-bold text-foreground">
            {formatNum(kos)} <span className="text-muted-foreground font-normal">({kosPercent.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Damage</span>
          <span className="font-bold text-foreground">
            {formatCompact(dmg)} <span className="text-muted-foreground font-normal">({dmgPercent.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Time held</span>
          <span className="font-bold text-foreground">
            {formatHours(time)} <span className="text-muted-foreground font-normal">({timePercent.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="flex justify-between pt-1 border-t border-border/20">
          <span className="text-muted-foreground">DPS</span>
          <span className="font-bold text-foreground">{dps.toFixed(1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Time to KO</span>
          <span className="font-bold text-foreground">{timeToKill === null ? '-' : `${timeToKill.toFixed(1)}s`}</span>
        </div>
      </div>
    </div>
  )
}

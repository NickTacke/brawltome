import { X } from 'lucide-react'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { formatCompact, formatGrouped, legendName } from './player-format'
import { DetailStat } from './StatCells'
import type { WeaponStats } from './weapon-stats'

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function averageText(values: number[], hasGames: boolean): string {
  return hasGames ? formatGrouped(Math.round(average(values))) : '–'
}

function BestLegend({ label, legendKey, value }: { label: string; legendKey: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <img
        src={legendAvatarUrl(legendKey)}
        alt=""
        className="size-10 shrink-0 rounded-md bg-raised object-cover object-top"
      />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-soft">{label}</div>
        <div className="truncate text-sm font-semibold text-strong">
          <span className="capitalize">{legendName(legendKey)}</span>{' '}
          <span className="font-mono font-normal text-soft">{value}</span>
        </div>
      </div>
    </div>
  )
}

function WeaponFigures({ weapon }: { weapon: WeaponStats }) {
  const { ranked } = weapon
  const hasRankedGames = ranked.games > 0
  const damagePerKo = weapon.KOs > 0 ? Math.round(weapon.damage / weapon.KOs) : 0

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-6 gap-y-3">
      <DetailStat label="Share" value={`${(weapon.share * 100).toFixed(1)}%`} />
      <DetailStat label="Damage" value={formatCompact(weapon.damage)} />
      <DetailStat label="Damage / KO" value={formatGrouped(damagePerKo)} />
      <DetailStat label="Legends" value={formatGrouped(weapon.legendCount)} />
      <DetailStat label="Ranked games" value={formatGrouped(ranked.games)} />
      <DetailStat label="Avg elo" value={averageText(ranked.ratings, hasRankedGames)} />
      <DetailStat label="Avg peak" value={averageText(ranked.peakRatings, hasRankedGames)} />
    </div>
  )
}

export function WeaponDetail({ weapon, onClose }: { weapon: WeaponStats; onClose: () => void }) {
  const { ranked } = weapon

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <img src={`/images/weapons/${weapon.weapon}.svg`} alt="" className="size-10 shrink-0 object-contain" />
        <div className="min-w-0 flex-1 text-lg font-bold text-strong">{weapon.weapon}</div>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="text-soft transition-colors hover:text-strong"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-4">
        <WeaponFigures weapon={weapon} />
        {ranked.games > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <BestLegend
              label="Most played"
              legendKey={ranked.mostPlayed.key}
              value={`${formatGrouped(ranked.mostPlayed.games)} games`}
            />
            <BestLegend
              label="Highest elo"
              legendKey={ranked.highestElo.key}
              value={formatGrouped(ranked.highestElo.elo)}
            />
            <BestLegend
              label="Highest peak"
              legendKey={ranked.highestPeak.key}
              value={formatGrouped(ranked.highestPeak.elo)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

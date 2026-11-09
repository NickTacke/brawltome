import { getLegendById, normalizeWeaponName } from '@brawltome/game-data'
import { X } from 'lucide-react'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import {
  bestRating,
  formatCompact,
  formatGrouped,
  formatHours,
  legendName,
  rankBanner,
  tierName,
  winPercent,
  winRateColour,
} from './player-format'
import { DetailStat } from './StatCells'
import { WinBar, WinRateLabel } from './WinBar'
import type { CareerLegend, RankedLegend } from './weapon-stats'

type LegendExpandedProps = { legend: CareerLegend; ranked: RankedLegend | undefined; onClose: () => void }

function ratio(top: number, bottom: number): number {
  return bottom > 0 ? top / bottom : 0
}

function RecordLine({ wins, games }: { wins: number; games: number }) {
  const percent = winPercent(wins, games)

  return (
    <div>
      <WinBar wins={wins} games={games} />
      <div className="mt-1.5 flex justify-between font-mono text-sm text-soft">
        <span>
          {formatGrouped(wins)}W {formatGrouped(games - wins)}L
        </span>
        <span>
          <WinRateLabel /> <span className={`font-semibold ${winRateColour(percent)}`}>{percent.toFixed(1)}%</span>
        </span>
      </div>
    </div>
  )
}

function CombatStats({ legend }: { legend: CareerLegend }) {
  const dealt = Number(legend.damageDealt)
  const taken = Number(legend.damageTaken)

  return (
    <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-6 gap-y-3">
      <DetailStat label="Games" value={formatGrouped(legend.games)} />
      <DetailStat label="KOs" value={formatGrouped(legend.kos)} />
      <DetailStat label="Falls" value={formatGrouped(legend.falls)} />
      <DetailStat label="KO / fall" value={ratio(legend.kos, legend.falls).toFixed(2)} />
      <DetailStat label="KOs / game" value={ratio(legend.kos, legend.games).toFixed(1)} />
      <DetailStat label="Damage dealt" value={formatCompact(dealt)} />
      <DetailStat label="Damage taken" value={formatCompact(taken)} />
      <DetailStat label="Damage / KO" value={formatGrouped(Math.round(ratio(dealt, legend.kos)))} />
      <DetailStat label="Self KOs" value={formatGrouped(legend.suicides)} />
      <DetailStat label="Team KOs" value={formatGrouped(legend.teamKos)} />
    </div>
  )
}

function RankedSummary({ ranked }: { ranked: RankedLegend }) {
  const peak = bestRating(ranked.rating, ranked.peakRating)

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <img src={rankBanner(ranked.tier)} alt="" className="h-16 w-12 shrink-0 object-contain" />
        <div className="min-w-0">
          <div className="truncate font-bold text-text">{tierName(ranked.tier)}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl leading-none font-black tracking-tight text-strong">
              {formatGrouped(ranked.rating)}
            </span>
            {ranked.games > 0 && (
              <span className="font-mono text-sm text-soft">
                {ranked.rating >= peak ? 'At peak' : `/ ${formatGrouped(peak)}`}
              </span>
            )}
          </div>
        </div>
      </div>
      {ranked.games > 0 && (
        <div className="mt-3">
          <RecordLine wins={ranked.wins} games={ranked.games} />
        </div>
      )}
    </div>
  )
}

type WeaponUsageProps = { name: string; heldTime: number | null; kos: number; damage: string }

function WeaponUsage({ name, heldTime, kos, damage }: WeaponUsageProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <img src={`/images/weapons/${name}.svg`} alt="" loading="lazy" className="size-9 object-contain" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-strong">{name}</div>
        <div className="font-mono text-xs text-soft">
          {heldTime === null ? '' : `${formatHours(heldTime)} · `}
          {formatGrouped(kos)} KOs · {formatCompact(Number(damage))}
        </div>
      </div>
    </div>
  )
}

function LegendWeapons({ legend }: { legend: CareerLegend }) {
  const reference = getLegendById(legend.legendId)

  if (!reference) return null

  const { weaponOne, weaponTwo, unarmed } = legend

  return (
    <div className="grid gap-3 border-t border-line/40 pt-4 sm:grid-cols-3">
      <WeaponUsage
        name={normalizeWeaponName(reference.weaponOne)}
        heldTime={weaponOne.heldTime}
        kos={weaponOne.kos}
        damage={weaponOne.damage}
      />
      <WeaponUsage
        name={normalizeWeaponName(reference.weaponTwo)}
        heldTime={weaponTwo.heldTime}
        kos={weaponTwo.kos}
        damage={weaponTwo.damage}
      />
      <WeaponUsage name="Unarmed" heldTime={null} kos={unarmed.kos} damage={unarmed.damage} />
    </div>
  )
}

export function LegendExpanded({ legend, ranked, onClose }: LegendExpandedProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <img
          src={legendAvatarUrl(legend.legendNameKey)}
          alt=""
          className="size-12 shrink-0 rounded-md bg-raised object-cover object-top"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-strong capitalize">{legendName(legend.legendNameKey)}</div>
          <div className="font-mono text-sm text-soft">
            Lvl {legend.level} · {formatGrouped(legend.xp)} XP · {formatHours(legend.matchTime)}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="text-soft transition-colors hover:text-strong"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <RecordLine wins={legend.wins} games={legend.games} />
          <CombatStats legend={legend} />
        </div>
        {ranked && <RankedSummary ranked={ranked} />}
      </div>
      <LegendWeapons legend={legend} />
    </div>
  )
}

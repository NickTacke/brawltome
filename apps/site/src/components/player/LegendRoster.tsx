import { useState } from 'react'
import { FilterSelect } from '../FilterSelect'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { LegendExpanded } from './LegendExpanded'
import {
  formatCompact,
  formatGrouped,
  formatHours,
  legendName,
  rankBanner,
  tierColour,
  winPercent,
  winRateColour,
} from './player-format'
import { sectionTitle } from './player-styles'
import { defaultLegendSort, type LegendSortKey, legendSortOptions, legendSorts, sortLegends } from './roster-sort'
import { CardStat } from './StatCells'
import { TileGrid } from './TileGrid'
import type { CareerLegend, RankedLegend } from './weapon-stats'

const legendTileRem = 4.25
const legendCollapsedRows = 3
const frameStrengthPercent = 50
const maximumLevel = 100

function LegendCard({ legend, ranked }: { legend: CareerLegend; ranked: RankedLegend | undefined }) {
  const percent = winPercent(legend.wins, legend.games)

  return (
    <>
      <div className="flex items-center gap-2.5">
        <img
          src={legendAvatarUrl(legend.legendNameKey)}
          alt=""
          className="size-10 shrink-0 rounded-md bg-raised object-cover object-top"
        />
        <div className="min-w-0">
          <div className="truncate font-bold text-strong capitalize">{legendName(legend.legendNameKey)}</div>
          <div className="font-mono text-xs text-soft">
            Lvl {legend.level} · {formatCompact(legend.xp)} XP
          </div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <CardStat label="Games">{formatCompact(legend.games)}</CardStat>
        <CardStat label="Win rate">
          <span className={winRateColour(percent)}>{percent.toFixed(1)}%</span>
        </CardStat>
        <CardStat label="Time">{formatHours(legend.matchTime)}</CardStat>
      </div>
      {ranked && (
        <div className="mt-2.5 flex items-center gap-2.5 border-t border-line/50 pt-2.5">
          <img src={rankBanner(ranked.tier)} alt="" className="h-9 w-6 shrink-0 object-contain" />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{ranked.tier}</div>
          <div className="font-mono text-sm font-bold text-strong">{formatGrouped(ranked.rating)}</div>
        </div>
      )}
    </>
  )
}

type LegendTileProps = { legend: CareerLegend; ranked: RankedLegend | undefined; value: string; isSelected: boolean }

function LegendTile({ legend, ranked, value, isSelected }: LegendTileProps) {
  const frameColour = `color-mix(in srgb, ${tierColour(ranked?.tier)} ${frameStrengthPercent}%, var(--color-ink))`

  return (
    <span
      className={`block overflow-hidden rounded-lg p-[2px] pb-0 transition-transform duration-150 group-hover:scale-105 ${isSelected ? 'ring-2 ring-primary' : ''}`}
      style={{ backgroundColor: frameColour }}
    >
      <img
        src={legendAvatarUrl(legend.legendNameKey)}
        alt=""
        loading="lazy"
        className="block aspect-square w-full rounded-md bg-raised object-cover object-top"
      />
      <span className="block truncate py-0.5 text-center text-[13px] leading-tight font-black tracking-tight text-strong tabular-nums">
        {value}
      </span>
    </span>
  )
}

type LegendRosterProps = { legends: CareerLegend[]; rankedLegends: RankedLegend[] }

export function LegendRoster({ legends, rankedLegends }: LegendRosterProps) {
  const [sort, setSort] = useState<LegendSortKey>(defaultLegendSort)

  if (legends.length === 0) return null

  const rankedById = new Map(rankedLegends.map((ranked) => [ranked.legendId, ranked]))
  const rankedOf = (legend: CareerLegend) => rankedById.get(legend.legendId)
  const valueOf = (legend: CareerLegend) => legendSorts[sort].value(legend, rankedOf(legend) as RankedLegend)
  const sorted = sortLegends(legends, rankedById, sort)
  const maxedCount = legends.filter((legend) => legend.level >= maximumLevel).length

  return (
    <section aria-labelledby="legends">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 id="legends" className={sectionTitle}>
            Legends
          </h2>
          {maxedCount > 0 && (
            <span className="text-[13px] whitespace-nowrap text-soft tabular-nums">
              <span className="font-black text-strong">{maxedCount}</span> at level 100
            </span>
          )}
        </div>
        <FilterSelect
          label="Sort"
          value={sort}
          options={legendSortOptions}
          onChange={(value) => setSort(value as LegendSortKey)}
        />
      </div>
      <div className="mt-3">
        <TileGrid
          items={sorted}
          keyOf={(legend) => String(legend.legendId)}
          labelOf={(legend) => legendName(legend.legendNameKey)}
          minimumTileRem={legendTileRem}
          collapsedRows={legendCollapsedRows}
          renderTile={(legend, isSelected) => (
            <LegendTile legend={legend} ranked={rankedOf(legend)} value={valueOf(legend)} isSelected={isSelected} />
          )}
          renderCard={(legend) => <LegendCard legend={legend} ranked={rankedOf(legend)} />}
          renderDetail={(legend, close) => <LegendExpanded legend={legend} ranked={rankedOf(legend)} onClose={close} />}
        />
      </div>
    </section>
  )
}

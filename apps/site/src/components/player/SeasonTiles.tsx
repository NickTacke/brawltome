import { FilterSelect } from '../FilterSelect'
import { smoothPath } from './chart-geometry'
import { formatGrouped, rankBanner, tierColour, winPercent, winRateColour } from './player-format'
import { type ChartPoint, type Season, seasonTotals, shownSeasons } from './rating-seasons'

function TileLine({ points, colour }: { points: ChartPoint[]; colour: string }) {
  const ratings = points.map((point) => point.rating)
  const low = Math.min(...ratings)
  const span = Math.max(Math.max(...ratings) - low, 1)
  const start = points[0]?.time ?? 0
  const duration = Math.max((points.at(-1)?.time ?? 1) - start, 1)

  const coordinates = points.map((point) => ({
    x: ((point.time - start) / duration) * 100,
    y: 28 - ((point.rating - low) / span) * 26,
  }))

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="pointer-events-none absolute right-0 bottom-3 h-9 w-[30%] opacity-80 transition-opacity duration-150 group-hover:opacity-100 @max-[14rem]:hidden"
      aria-hidden="true"
    >
      <path
        d={smoothPath(coordinates)}
        fill="none"
        stroke={colour}
        strokeOpacity="0.7"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function SeasonTile({ season, isSelected, onSelect }: { season: Season; isSelected: boolean; onSelect: () => void }) {
  const totals = seasonTotals(season)
  const percent = winPercent(totals.wins, totals.games)
  const colour = tierColour(totals.tier)

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
      className="group @container relative flex min-w-0 cursor-pointer items-center gap-2.5 pb-1.5 text-left"
    >
      <img
        src={rankBanner(totals.tier)}
        alt=""
        className="h-[52px] w-[38px] shrink-0 object-contain transition-transform duration-150 group-hover:scale-110"
      />
      <span className="relative min-w-0">
        <span
          className={`block truncate text-xs font-bold transition-colors ${isSelected ? 'text-strong' : 'text-soft group-hover:text-strong'}`}
        >
          Season {season.id}
        </span>
        <span className="block text-xl leading-tight font-black tracking-tight text-strong">
          {formatGrouped(totals.peak)}
        </span>
        <span className="block font-mono text-xs whitespace-nowrap text-soft">
          <span className={`font-bold ${winRateColour(percent)}`}>{percent.toFixed(0)}%</span> of{' '}
          {formatGrouped(totals.games)}
        </span>
      </span>
      <TileLine points={season.points} colour={colour} />
      <span
        className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-opacity duration-150 ${isSelected ? '' : 'opacity-0 group-hover:opacity-60'}`}
        style={{ backgroundColor: `color-mix(in srgb, ${colour} 70%, var(--color-ink))` }}
        aria-hidden="true"
      />
    </button>
  )
}

type SeasonTilesProps = { seasons: Season[]; selectedId: string; onSelect: (id: string) => void }

export function SeasonTiles({ seasons, selectedId, onSelect }: SeasonTilesProps) {
  const shown = shownSeasons(seasons, selectedId)

  const older = seasons
    .filter((season) => !shown.includes(season))
    .map((season) => ({ value: String(season.id), label: `Season ${season.id}` }))

  return (
    <div className="mt-1 flex flex-wrap items-center justify-end gap-x-6 gap-y-1">
      <div
        data-season-picker
        className="grid min-w-0 flex-1 basis-full grid-cols-2 gap-x-6 gap-y-2 sm:basis-0 sm:grid-cols-4"
      >
        {shown.map((season) => (
          <SeasonTile
            key={season.id}
            season={season}
            isSelected={String(season.id) === selectedId}
            onSelect={() => onSelect(String(season.id))}
          />
        ))}
      </div>
      {older.length > 0 && (
        <FilterSelect
          label="Older seasons"
          value=""
          options={older}
          placeholder="Older"
          isLabelHidden
          onChange={onSelect}
        />
      )}
    </div>
  )
}

import { useState } from 'react'
import { FilterSelect } from '../FilterSelect'
import { excludeUnarmedCookie, formatCompact, formatHours, winPercent, winRateColour } from './player-format'
import { sectionTitle } from './player-styles'
import { sortWeapons, type WeaponSortKey, weaponSortOptions, weaponSorts } from './roster-sort'
import { CardStat } from './StatCells'
import { TileGrid } from './TileGrid'
import { unarmedStats } from './unarmed-stats'
import { WeaponDetail } from './WeaponDetail'
import { type CareerLegend, type RankedLegend, type WeaponStats, weaponStats, withShares } from './weapon-stats'

const weaponColumnsClass = 'grid-cols-8 min-[1500px]:grid-cols-[repeat(var(--tile-count),minmax(0,1fr))]'
const tallestWeaponBarPx = 56
const smallestWeaponBarPx = 2
const oneYearSeconds = 31_536_000

function WeaponCard({ weapon }: { weapon: WeaponStats }) {
  const percent = winPercent(weapon.wins, weapon.games)

  return (
    <>
      <div className="flex items-center gap-2.5">
        <img src={`/images/weapons/${weapon.weapon}.svg`} alt="" className="size-10 shrink-0 object-contain" />
        <div className="min-w-0">
          <div className="truncate font-bold text-strong">{weapon.weapon}</div>
          <div className="font-mono text-xs text-soft">{(weapon.share * 100).toFixed(1)}% of time held</div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <CardStat label="Time">{formatHours(weapon.timeHeld)}</CardStat>
        <CardStat label="Win rate">
          {weapon.games > 0 ? <span className={winRateColour(percent)}>{percent.toFixed(1)}%</span> : '–'}
        </CardStat>
        <CardStat label="KOs">{formatCompact(weapon.KOs)}</CardStat>
      </div>
    </>
  )
}

type WeaponColumnProps = { weapon: WeaponStats; value: string; barHeightPx: number; isSelected: boolean }

function WeaponColumn({ weapon, value, barHeightPx, isSelected }: WeaponColumnProps) {
  return (
    <span className="flex h-full flex-col justify-end">
      <span className="block truncate text-center text-[11px] font-bold text-soft tabular-nums group-hover:text-strong sm:text-xs">
        {value}
      </span>
      <span
        className="mx-auto mt-1 block w-3/5 rounded-t-[3px] bg-primary/55 transition-colors group-hover:bg-primary"
        style={{ height: barHeightPx }}
      />
      <img
        src={`/images/weapons/${weapon.weapon}.svg`}
        alt=""
        loading="lazy"
        className={`mx-auto mt-1 block aspect-square w-[84%] max-w-14 min-[137.5rem]:max-w-[72px] rounded-md object-contain transition-[filter,transform] duration-150 group-hover:scale-105 group-hover:brightness-125 ${isSelected ? 'ring-2 ring-primary' : ''}`}
      />
    </span>
  )
}

function UnarmedToggle({ isExcluded, onChange }: { isExcluded: boolean; onChange: (isExcluded: boolean) => void }) {
  return (
    <label className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-sm px-2 py-1.5 text-sm font-medium whitespace-nowrap text-text transition-colors hover:bg-white/[0.06]">
      Exclude unarmed
      <input
        type="checkbox"
        role="switch"
        checked={isExcluded}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        data-switch
        aria-hidden="true"
        className="relative h-4 w-7 shrink-0 rounded-full bg-white/[0.14] transition-colors peer-checked:bg-primary/70 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-3"
      />
    </label>
  )
}

type WeaponStripProps = { legends: CareerLegend[]; rankedLegends: RankedLegend[]; isUnarmedExcludedAtStart: boolean }

export function WeaponStrip({ legends, rankedLegends, isUnarmedExcludedAtStart }: WeaponStripProps) {
  const [sort, setSort] = useState<WeaponSortKey>('playtime')
  const [isUnarmedExcluded, setIsUnarmedExcluded] = useState(isUnarmedExcludedAtStart)
  const active = weaponSorts[sort]
  const held = weaponStats(legends, rankedLegends)
  const withUnarmed = isUnarmedExcluded ? held : withShares([...held, unarmedStats(legends)])
  const weapons = sortWeapons(withUnarmed, sort)

  if (weapons.length === 0) return null

  const highestScore = Math.max(...weapons.map(active.score), 1)

  function changeUnarmedExcluded(isExcluded: boolean) {
    setIsUnarmedExcluded(isExcluded)
    document.cookie = `${excludeUnarmedCookie}=${isExcluded ? 1 : 0}; max-age=${oneYearSeconds}; path=/; samesite=lax`
  }

  function renderTile(weapon: WeaponStats, isSelected: boolean) {
    const barHeightPx = Math.max((active.score(weapon) / highestScore) * tallestWeaponBarPx, smallestWeaponBarPx)

    return (
      <WeaponColumn weapon={weapon} value={active.value(weapon)} barHeightPx={barHeightPx} isSelected={isSelected} />
    )
  }

  return (
    <section aria-labelledby="weapons">
      <div className="flex items-center justify-between gap-4">
        <h2 id="weapons" className={sectionTitle}>
          Weapons
        </h2>
        <FilterSelect
          label="Sort"
          value={sort}
          options={weaponSortOptions}
          footer={<UnarmedToggle isExcluded={isUnarmedExcluded} onChange={changeUnarmedExcluded} />}
          onChange={(value) => setSort(value as WeaponSortKey)}
        />
      </div>
      <div className="mt-3">
        <TileGrid
          items={weapons}
          keyOf={(weapon) => weapon.weapon}
          labelOf={(weapon) => weapon.weapon}
          columnsClass={weaponColumnsClass}
          renderTile={renderTile}
          renderCard={(weapon) => <WeaponCard weapon={weapon} />}
          renderDetail={(weapon, close) => <WeaponDetail weapon={weapon} onClose={close} />}
        />
      </div>
    </section>
  )
}

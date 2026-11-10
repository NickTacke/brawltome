import { formatWhole } from '../../lib'
import type { MetaLegend } from '../../server/load-meta-legends'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { winRateColour } from '../player/player-format'
import { stripedTallRowStyle } from '../table-styles'
import { legendDisplayName } from './legend-display-name'
import { columnLabelStyle, Place, RankedTable } from './RankedTable'
import { SectionHeader } from './SectionHeader'

const statWidthStyle = 'w-16 sm:w-20'
const statCellStyle = `${statWidthStyle} px-3 text-right font-mono`

function MetaTableHead() {
  return (
    <>
      <th scope="col" className={`w-12 pr-1 text-left ${columnLabelStyle}`}>
        #
      </th>
      <th scope="col" className={`pl-0 text-left ${columnLabelStyle}`}>
        Legend
      </th>
      <th scope="col" className={`${statWidthStyle} text-right ${columnLabelStyle}`}>
        Games
      </th>
      <th scope="col" className={`${statWidthStyle} text-right ${columnLabelStyle}`}>
        Players
      </th>
      <th scope="col" className={`${statWidthStyle} text-right ${columnLabelStyle}`}>
        Win rate
      </th>
    </>
  )
}

function MetaLegendRow({ legend, place }: { legend: MetaLegend; place: number }) {
  const name = legendDisplayName(legend.legendNameKey)
  const winPercent = legend.winRate * 100

  return (
    <tr className={stripedTallRowStyle}>
      <Place place={place} />
      <td className="max-w-0 pr-3">
        <div title={name} className="flex items-center gap-3">
          <div className="size-9 shrink-0 overflow-hidden rounded-md bg-raised">
            <img src={legendAvatarUrl(legend.legendNameKey)} alt="" className="size-full object-cover object-top" />
          </div>
          <span className="truncate text-base font-semibold text-strong">{name}</span>
        </div>
      </td>
      <td className={`${statCellStyle} font-semibold text-strong`}>{formatWhole(legend.games)}</td>
      <td className={`${statCellStyle} text-soft`}>{formatWhole(legend.playerCount)}</td>
      <td className={`${statCellStyle} font-bold ${winRateColour(winPercent)}`}>{winPercent.toFixed(1)}%</td>
    </tr>
  )
}

export function MetaLegends({ legends }: { legends: MetaLegend[] }) {
  return (
    <section className="min-w-0">
      <SectionHeader title="Meta legends" />
      <p className="text-sm text-soft">Most played by players rated 2000+ this season</p>
      <RankedTable head={<MetaTableHead />}>
        {legends.map((legend, index) => (
          <MetaLegendRow key={legend.legendNameKey} legend={legend} place={index + 1} />
        ))}
      </RankedTable>
    </section>
  )
}

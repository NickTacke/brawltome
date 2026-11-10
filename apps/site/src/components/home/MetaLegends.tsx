import { formatWhole } from '../../lib'
import type { MetaLegend } from '../../server/load-meta-legends'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { legendDisplayName } from './legend-display-name'
import { SectionHeader } from './SectionHeader'

function MetaLegendTile({ legend }: { legend: MetaLegend }) {
  const name = legendDisplayName(legend.legendNameKey)
  const winPercent = legend.winRate * 100
  const detail = `${name} · ${winPercent.toFixed(1)}% win rate · ${formatWhole(legend.playerCount)} players`

  return (
    // the same tile as most played, so the two halves of the row line up
    <figure title={detail} className="flex min-w-0 flex-col items-center">
      <div className="size-12 overflow-hidden rounded-lg bg-raised">
        <img
          src={legendAvatarUrl(legend.legendNameKey)}
          alt=""
          loading="lazy"
          className="size-full object-cover object-top"
        />
      </div>
      <figcaption className="mt-1.5 max-w-full truncate text-center text-xs font-semibold text-text">{name}</figcaption>
      <span className="font-mono text-xs font-bold text-strong">{formatWhole(legend.averageRating)}</span>
    </figure>
  )
}

/** The legends whose players hold the highest average rating on them this season. */
export function MetaLegends({ legends }: { legends: MetaLegend[] }) {
  return (
    <section className="min-w-0">
      <SectionHeader title="Meta legends" action={<span className="text-sm text-soft">Average elo</span>} />
      <div className="mt-4 grid grid-cols-5 gap-x-2 gap-y-4 sm:grid-cols-9">
        {legends.map((legend) => (
          <MetaLegendTile key={legend.legendNameKey} legend={legend} />
        ))}
      </div>
    </section>
  )
}

import { formatWhole } from '../../lib'
import type { MetaLegend } from '../../server/load-meta-legends'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { legendDisplayName } from './legend-display-name'
import { SectionHeader } from './SectionHeader'

function MetaLegendTile({ legend }: { legend: MetaLegend }) {
  const name = legendDisplayName(legend.legendNameKey)
  const sharePercent = (legend.gameShare * 100).toFixed(1)
  const winPercent = (legend.winRate * 100).toFixed(1)
  const players = formatWhole(legend.playerCount)
  const detail = `${name} · ${sharePercent}% of games at 2200+ · ${players} players · ${winPercent}% win rate`

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
      <span className="font-mono text-xs font-bold text-strong">{sharePercent}%</span>
    </figure>
  )
}

/** The legends players rated 2200+ play most this season, with each one's share of their games. */
export function MetaLegends({ legends }: { legends: MetaLegend[] }) {
  return (
    <section className="min-w-0">
      <SectionHeader title="Meta legends" action={<span className="text-sm text-soft">Share of games at 2200+</span>} />
      <div className="mt-4 grid grid-cols-5 gap-x-2 gap-y-4 sm:grid-cols-9">
        {legends.map((legend) => (
          <MetaLegendTile key={legend.legendNameKey} legend={legend} />
        ))}
      </div>
    </section>
  )
}

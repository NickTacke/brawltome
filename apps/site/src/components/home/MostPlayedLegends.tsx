import type { MostPlayedLegend } from '../../server/load-most-played-legends'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { legendName } from '../player/player-format'
import { SectionHeader } from './SectionHeader'

// legend keys are lowercase, and the name also shows in a title, which css can't capitalise
function capitalizeWords(name: string): string {
  return name.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function LegendShare({ legend }: { legend: MostPlayedLegend }) {
  const sharePercent = (legend.share * 100).toFixed(1)
  const name = capitalizeWords(legendName(legend.legendNameKey))

  return (
    // long names are cut off in the narrow columns, the title shows them whole
    <figure title={name} className="flex min-w-0 flex-col items-center">
      <div className="size-12 overflow-hidden rounded-lg bg-raised">
        <img
          src={legendAvatarUrl(legend.legendNameKey)}
          alt=""
          loading="lazy"
          className="size-full object-cover object-top"
        />
      </div>
      <figcaption className="mt-1.5 max-w-full truncate text-center text-xs font-semibold text-text">{name}</figcaption>
      <span className="font-mono text-xs text-soft">{sharePercent}%</span>
    </figure>
  )
}

export function MostPlayedLegends({ legends }: { legends: MostPlayedLegend[] }) {
  return (
    <section className="min-w-0">
      <SectionHeader title="Most played legends" action={<span className="text-sm text-soft">This season</span>} />
      <div className="mt-4 grid grid-cols-5 gap-x-2 gap-y-4 sm:grid-cols-9">
        {legends.map((legend) => (
          <LegendShare key={legend.legendNameKey} legend={legend} />
        ))}
      </div>
    </section>
  )
}

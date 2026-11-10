import type { MetaLegend } from '../../server/load-meta-legends'
import type { MostPlayedLegend } from '../../server/load-most-played-legends'
import { MetaLegends } from './MetaLegends'
import { MostPlayedLegends } from './MostPlayedLegends'

// the same halves as Home's top players and guilds, so the columns and the line between them line up
const halvesStyle = 'grid gap-y-8 xl:grid-cols-2 xl:divide-x xl:divide-line/50'

// separates the two while they are stacked, the halves' own line takes over at xl
const stackedLineStyle = 'border-t border-line/50 pt-8 xl:border-t-0 xl:pt-0'

type LegendsRowProps = { mostPlayed: MostPlayedLegend[]; meta: MetaLegend[] }

// each side hides when it has nothing to show: no season yet, nobody seen playing, or a failed read
export function LegendsRow({ mostPlayed, meta }: LegendsRowProps) {
  const hasMostPlayed = mostPlayed.length > 0
  const hasMeta = meta.length > 0

  if (!hasMostPlayed && !hasMeta) return null

  // pinned to the right column, so it keeps its place when most played is missing
  const metaStyle = `min-w-0 xl:col-start-2 xl:pl-12 ${hasMostPlayed ? stackedLineStyle : ''}`

  return (
    <div data-search-dim className={halvesStyle}>
      {hasMostPlayed && (
        <div className="min-w-0 xl:pr-12">
          <MostPlayedLegends legends={mostPlayed} />
        </div>
      )}
      {hasMeta && (
        <div className={metaStyle}>
          <MetaLegends legends={meta} />
        </div>
      )}
    </div>
  )
}

import type { MostPlayedLegend } from '../../server/load-most-played-legends'
import { MostPlayedLegends } from './MostPlayedLegends'

// the left of Home's halves, so the section keeps its width and place until meta legends fills the right
const leftHalfStyle = 'grid xl:grid-cols-2 xl:[&>*]:pr-12'

// hidden when there is nothing to show: no season yet, nobody seen playing, or a failed read
export function LegendsRow({ mostPlayed }: { mostPlayed: MostPlayedLegend[] }) {
  if (mostPlayed.length === 0) return null

  return (
    <div data-search-dim className={leftHalfStyle}>
      <MostPlayedLegends legends={mostPlayed} />
    </div>
  )
}

import type { MatchInsights } from '@brawltome/contracts'
import { formatClock } from './match-format'
import { queueName } from './queue-name'

// the map's background from the match's art: its address once loaded, held open while it downloads, or none
export type MapImage = { url: string | null; isComing: boolean }

function MapPicture({ image }: { image: MapImage }) {
  if (image.url) return <img src={image.url} alt="" className="size-20 shrink-0 rounded-xl bg-raised object-cover" />

  // the space is kept while the art downloads, so the name doesn't move when it arrives
  return <div className="size-20 shrink-0 rounded-xl bg-raised" />
}

/** What was played and where, at the top of the side column like a player's name on their page. */
export function MatchIdentity({ insights, mapImage }: { insights: MatchInsights; mapImage: MapImage }) {
  const { summary, extras } = insights
  const rules = extras.stocks ? `${extras.stocks} stocks` : summary.modeName
  const hasPicture = mapImage.url !== null || mapImage.isComing

  return (
    <div className="flex items-center gap-4">
      {hasPicture ? <MapPicture image={mapImage} /> : null}
      <div className="min-w-0">
        <h1 className={`leading-[1.15] font-black tracking-tight text-strong ${hasPicture ? 'text-2xl' : 'text-4xl'}`}>
          {summary.mapName}
        </h1>
        <div className="mt-1 text-sm leading-snug font-semibold text-text">{queueName(insights)}</div>
        <div className="text-sm leading-snug text-soft">
          {formatClock(summary.durationMs)} · {rules} · <span className="whitespace-nowrap">Patch {summary.patch}</span>
        </div>
      </div>
    </div>
  )
}

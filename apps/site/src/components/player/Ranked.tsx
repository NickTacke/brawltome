import { bestRating, eloReset, formatGrouped, rankBanner, tierName } from './player-format'
import { sectionBody, sectionTitle, statLabel } from './player-styles'
import { SplitRecord } from './SplitRecord'
import { noStanding, type Standing } from './side-summary'

const bigRating =
  'text-[2.25rem] leading-none font-black tracking-tight text-strong min-[400px]:text-[2.75rem] [@media(min-height:960px)]:text-[3.25rem] md:max-lg:text-[2.25rem]! lg:max-xl:text-[2.75rem]!'

const banner =
  'h-28 w-20 shrink-0 object-contain sm:h-36 sm:w-[6.5rem] md:max-lg:h-24! md:max-lg:w-[4.25rem]! lg:max-xl:h-32! lg:max-xl:w-24! xl:[@media(max-height:880px)]:h-28! xl:[@media(max-height:880px)]:w-20! [@media(min-height:960px)]:h-40 [@media(min-height:960px)]:w-[7.25rem]'

function PeakNote({ standing }: { standing: Standing }) {
  if (standing.games === 0) return null

  const peak = bestRating(standing.rating, standing.peakRating)

  if (standing.rating >= peak) return <span className={`${statLabel} text-soft/70`}>At peak</span>

  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-lg leading-none font-bold text-soft/70 min-[400px]:text-xl">/ {formatGrouped(peak)}</span>
      <span className={`${statLabel} text-soft/70`}>Peak</span>
    </span>
  )
}

function GamesAndReset({ standing }: { standing: Standing }) {
  return (
    <div className="text-[0.8125rem] whitespace-nowrap text-soft tabular-nums">
      <span className="font-black text-strong">{formatGrouped(standing.games)}</span> games ·{' '}
      <span className="font-black text-strong">{formatGrouped(eloReset(standing.rating))}</span> after reset
    </div>
  )
}

export function Ranked({ standing = noStanding }: { standing?: Standing }) {
  return (
    <section data-ranked>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 className={sectionTitle}>Ranked 1v1</h2>
        {standing.games > 0 && <GamesAndReset standing={standing} />}
      </div>
      <div className={sectionBody}>
        <div className="flex items-center gap-4">
          <img src={rankBanner(standing.tier)} alt="" className={banner} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-text">{tierName(standing.tier)}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span className={bigRating}>{formatGrouped(standing.rating)}</span>
              <PeakNote standing={standing} />
            </div>
            <div className="mt-2.5">
              <SplitRecord standing={standing} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

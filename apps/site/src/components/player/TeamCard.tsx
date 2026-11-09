import { Link } from '@tanstack/react-router'
import { formatGrouped, rankBanner, tierName, winPercent, winRateColour } from './player-format'
import { RatingAndPeak } from './RatingAndPeak'
import { type FixedTeam, teammateOf } from './side-summary'

export function TeamCard({ team, ownId }: { team: FixedTeam; ownId: number }) {
  const percent = winPercent(team.wins, team.games)
  const partner = teammateOf(team, ownId)

  return (
    <div className="group relative -mx-3 flex items-center gap-4 rounded-md px-3 py-3 transition-colors hover:bg-white/[0.04]">
      <img src={rankBanner(team.tier)} alt="" loading="lazy" className="h-[88px] w-16 shrink-0 object-contain" />
      {/* measured against the card, because two columns on a laptop are as narrow as a phone */}
      <div className="@container min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-x-4 @max-sm:flex-col @max-sm:items-stretch @max-sm:gap-y-1 @max-sm:[&>span]:justify-start">
          <Link
            to="/player/$id"
            params={{ id: String(partner.id) }}
            className="min-w-0 truncate text-xl font-bold text-strong transition-colors group-hover:text-primary after:absolute after:inset-0"
          >
            {partner.name}
          </Link>
          <RatingAndPeak standing={team} ratingClass="text-[2rem]" peakClass="text-lg" />
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-4 text-sm font-semibold text-soft">
          <span className="min-w-0 truncate">
            {tierName(team.tier)}
            <span className="font-mono font-normal @max-sm:hidden">
              {' · '}
              {formatGrouped(team.wins)}W {formatGrouped(team.games - team.wins)}L
            </span>
          </span>
          <span className="font-mono font-normal whitespace-nowrap">
            <span className={`font-bold ${winRateColour(percent)}`}>{percent.toFixed(1)}%</span> of{' '}
            {formatGrouped(team.games)}
          </span>
        </div>
      </div>
    </div>
  )
}

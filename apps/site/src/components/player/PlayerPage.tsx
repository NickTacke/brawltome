import type { PlayerPage as PlayerPageData } from '../../server/load-player'
import type { RefreshStatusProps } from '../refresh/RefreshStatus'
import { Career } from './Career'
import { Identity } from './Identity'
import { LegendRoster } from './LegendRoster'
import { Ranked } from './Ranked'
import { RatingHistory } from './RatingHistory'
import { rankedStanding } from './side-summary'
import { Teammates } from './Teammates'
import { TwoVsTwo } from './TwoVsTwo'
import { WeaponStrip } from './WeaponStrip'

type PlayerPageProps = PlayerPageData & { isUnarmedExcluded: boolean; refresh: RefreshStatusProps }

// wider than the shared page column, so the player page uses the space beside it on large screens
const widePage =
  'xl:relative xl:left-1/2 xl:w-[min(calc(100vw-3.5625rem-8rem),102.5rem)] xl:-translate-x-1/2 min-[137.5rem]:w-[min(calc(100vw-3.5625rem-8rem),127.5rem)]'

const columns =
  'grid gap-x-14 gap-y-4 xl:grid-cols-[22.5rem_minmax(0,1fr)] 2xl:grid-cols-[25rem_minmax(0,1fr)] min-[137.5rem]:grid-cols-[28.75rem_minmax(0,1fr)]'

const sideLayout =
  'flex min-w-0 flex-col md:max-xl:grid md:max-xl:grid-cols-2 md:max-xl:[&>*:first-child]:col-span-2 md:max-xl:[&>[data-twos]]:col-span-2 md:max-xl:[&>[data-career]]:pr-6 md:max-xl:[&>[data-ranked]]:border-l md:max-xl:[&>[data-ranked]]:border-line/50 md:max-xl:[&>[data-ranked]]:pl-6 md:max-xl:[&:not(:has([data-twos]))>[data-career]]:border-b-0 divide-y divide-line/50 self-start'

const sideSticky =
  'xl:[@media(min-height:710px)]:sticky xl:top-3 xl:[@media(min-height:740px)]:top-10 xl:[@media(min-height:740px)]:has-[[data-twos]]:min-h-[min(calc(100vh-5rem),65rem)] min-[137.5rem]:[@media(min-height:740px)]:has-[[data-twos]]:min-h-[min(calc(100vh-5rem),75rem)]'

const sideSpacing =
  'max-xl:border-b max-xl:border-line/50 max-xl:pb-4 [&>section]:flex [&>section]:flex-auto [&>section]:flex-col [&>section]:justify-center md:max-xl:[&>section]:justify-start [&>*]:py-3.5 max-xl:[&>*]:py-4 xl:[@media(max-height:880px)]:[&>*]:py-2 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 [&_[data-winbar]]:h-1 [&_[data-winbar]]:opacity-75'

const stackedSections =
  'divide-y divide-line/50 [&>*]:py-6 max-xl:[&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0'

/** A profile: the player's identity and rank stay on the left while the stats scroll. */
export function PlayerPage({ player, seasonStarts, loadedAt, isUnarmedExcluded, refresh }: PlayerPageProps) {
  const standing = rankedStanding(player.currentSeason) ?? undefined
  const snapshot = player.currentSeason?.snapshot
  const legends = player.career?.snapshot?.legends ?? []
  const rankedLegends = snapshot?.rankedLegends ?? []

  return (
    <div className={`${columns} ${widePage}`}>
      <aside className={`${sideLayout} ${sideSticky} ${sideSpacing}`}>
        <Identity player={player} loadedAt={loadedAt} refresh={refresh} />
        <Career snapshot={player.career?.snapshot ?? null} />
        <Ranked standing={standing} />
        <TwoVsTwo
          teams={snapshot?.fixedTeams ?? []}
          soloQueue={snapshot?.soloQueue ?? []}
          playerId={player.brawlhallaId}
        />
      </aside>
      <div className={`min-w-0 ${stackedSections} xl:border-l xl:border-line/50 xl:pl-14`}>
        <RatingHistory history={snapshot?.ratingHistory ?? []} seasonStarts={seasonStarts} />
        <LegendRoster legends={legends} rankedLegends={rankedLegends} />
        <WeaponStrip legends={legends} rankedLegends={rankedLegends} isUnarmedExcludedAtStart={isUnarmedExcluded} />
        <Teammates teams={snapshot?.fixedTeams ?? []} playerId={player.brawlhallaId} />
      </div>
    </div>
  )
}

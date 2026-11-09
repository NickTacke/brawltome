import type { PlayerPage as PlayerPageData } from '../../server/load-player'
import { Career } from './Career'
import { Identity } from './Identity'
import { Ranked } from './Ranked'
import { RatingHistory } from './RatingHistory'
import { rankedStanding } from './side-summary'
import { TwoVsTwo } from './TwoVsTwo'

type PlayerPageProps = PlayerPageData & { isUnarmedExcluded: boolean }

// wider than the shared page column, so the player page uses the space beside it on large screens
const widePage =
  'xl:relative xl:left-1/2 xl:w-[min(calc(100vw-57px-8rem),1640px)] xl:-translate-x-1/2 min-[137.5rem]:w-[min(calc(100vw-57px-8rem),2040px)]'

const columns =
  'grid gap-x-14 gap-y-4 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)] min-[137.5rem]:grid-cols-[460px_minmax(0,1fr)]'

const sideLayout =
  'flex min-w-0 flex-col md:max-xl:grid md:max-xl:grid-cols-2 md:max-xl:[&>*:first-child]:col-span-2 md:max-xl:[&>[data-twos]]:col-span-2 md:max-xl:[&>[data-career]]:pr-6 md:max-xl:[&>[data-ranked]]:border-l md:max-xl:[&>[data-ranked]]:border-line/50 md:max-xl:[&>[data-ranked]]:pl-6 md:max-xl:[&:not(:has([data-twos]))>[data-career]]:border-b-0 divide-y divide-line/50 self-start'

const sideSticky =
  'xl:[@media(min-height:710px)]:sticky xl:top-3 xl:[@media(min-height:740px)]:top-10 xl:[@media(min-height:740px)]:has-[[data-twos]]:min-h-[min(calc(100vh-5rem),1040px)] min-[137.5rem]:[@media(min-height:740px)]:has-[[data-twos]]:min-h-[min(calc(100vh-5rem),1200px)]'

const sideSpacing =
  'max-xl:border-b max-xl:border-line/50 max-xl:pb-4 [&>section]:flex [&>section]:flex-auto [&>section]:flex-col [&>section]:justify-center md:max-xl:[&>section]:justify-start [&>*]:py-3.5 max-xl:[&>*]:py-4 xl:[@media(max-height:880px)]:[&>*]:py-2 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 [&_[data-winbar]]:h-1 [&_[data-winbar]]:opacity-75'

const stackedSections =
  'divide-y divide-line/50 [&>*]:py-6 max-xl:[&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0'

/** A profile: the player's identity and rank stay on the left while the stats scroll. */
export function PlayerPage({ player, seasonStarts, loadedAt, isUnarmedExcluded: _isUnarmedExcluded }: PlayerPageProps) {
  const standing = rankedStanding(player.currentSeason) ?? undefined
  const snapshot = player.currentSeason?.snapshot

  return (
    <div className={`${columns} ${widePage}`}>
      <aside className={`${sideLayout} ${sideSticky} ${sideSpacing}`}>
        <Identity player={player} loadedAt={loadedAt} />
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
      </div>
    </div>
  )
}

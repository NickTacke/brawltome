import type { MatchDetailContract, MatchInsights } from '@brawltome/contracts'
import { ReviewReplay } from './review/ReviewReplay'
import { useLegends } from './stage/use-legends'
import { WatchProvider } from './watch-moment'

// past the content column on wide screens, as the replay wants the room; the rail is 3.5625rem
const widePage =
  'xl:relative xl:left-1/2 xl:w-[min(calc(100vw-3.5625rem-8rem),102.5rem)] xl:-translate-x-1/2 ultrawide:w-[min(calc(100vw-3.5625rem-8rem),127.5rem)]'

type MatchPageProps = { match: MatchDetailContract; insights: MatchInsights }

/** The review page of a stock 1v1 or 2v2: the match played back on its stage, with what happened in it. */
export function MatchPage({ match, insights }: MatchPageProps) {
  const legends = useLegends(match.art, match.playbackPath)

  return (
    <WatchProvider>
      <div className={`py-10 ${widePage}`}>
        <h1 className="mb-6 text-4xl font-black tracking-tight text-strong">{match.mapName}</h1>
        {/* the first player until the page lets you pick one */}
        <ReviewReplay insights={insights} legends={legends} selectedSlot={1} />
      </div>
    </WatchProvider>
  )
}

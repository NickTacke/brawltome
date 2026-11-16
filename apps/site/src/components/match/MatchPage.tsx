import type { MatchDetailContract, MatchInsights } from '@brawltome/contracts'
import { useRef } from 'react'
import { MatchIdentity } from './MatchIdentity'
import { columnPiece, mainColumn, modulesColumn, pageColumns, sideColumn } from './match-layout'
import { MatchModules } from './modules/MatchModules'
import { NeutralByStock } from './NeutralByStock'
import { ReviewReplay } from './review/ReviewReplay'
import { Scoreboard } from './Scoreboard'
import { backgroundUrlOf } from './stage/background-url'
import { useLegends } from './stage/use-legends'
import { usePickedPlayer } from './use-picked-player'
import { useStickyTop } from './use-sticky-top'
import { WatchProvider } from './watch-moment'

// past the content column on wide screens, as the replay wants the room; the rail is 3.5625rem
const widePage =
  'xl:relative xl:left-1/2 xl:w-[min(calc(100vw-3.5625rem-8rem),102.5rem)] xl:-translate-x-1/2 ultrawide:w-[min(calc(100vw-3.5625rem-8rem),127.5rem)]'

type MatchPageProps = { match: MatchDetailContract; insights: MatchInsights }

/**
 * The review page of a stock 1v1 or 2v2: who played down the side, the replay first, the numbers behind it underneath.
 * Picking a player turns the whole page to them without reloading the replay.
 */
export function MatchPage({ match, insights }: MatchPageProps) {
  const { players, picked, pick } = usePickedPlayer(insights)
  const legends = useLegends(match.art, match.playbackPath)
  const sideRef = useRef<HTMLElement>(null)
  const sideTopPx = useStickyTop(sideRef)

  if (!picked) return null

  const mapImage = { url: backgroundUrlOf(legends.replay), isComing: legends.isDownloading }

  return (
    <WatchProvider>
      <div className={`pb-10 ${widePage} ${pageColumns}`}>
        <aside ref={sideRef} className={sideColumn} style={{ top: sideTopPx }}>
          <div className={`${columnPiece} max-xl:order-1 max-xl:pt-0`}>
            <MatchIdentity insights={insights} mapImage={mapImage} />
          </div>
          <div className={`${columnPiece} max-xl:order-1`}>
            <Scoreboard
              players={players}
              selectedSlot={picked.slot}
              stocks={insights.extras.stocks ?? 0}
              onSelect={pick}
            />
          </div>
          <div className={`${columnPiece} max-xl:order-3`}>
            <NeutralByStock matchPlayer={picked} />
          </div>
        </aside>
        <div className={mainColumn}>
          <div className={`${columnPiece} max-xl:order-2`}>
            <ReviewReplay insights={insights} legends={legends} selectedSlot={picked.slot} />
          </div>
          <div className={`max-xl:order-4 ${modulesColumn}`}>
            <MatchModules insights={insights} players={players} picked={picked} onPick={pick} />
          </div>
        </div>
      </div>
    </WatchProvider>
  )
}

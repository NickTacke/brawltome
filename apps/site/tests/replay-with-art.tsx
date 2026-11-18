import type { MatchDetailContract, MatchInsights } from '@brawltome/contracts'
import { ReviewReplay } from '../src/components/match/review/ReviewReplay'
import { useLegends } from '../src/components/match/stage/use-legends'

type ReplayWithArtProps = {
  insights: MatchInsights
  art: MatchDetailContract['art']
  playbackPath: string | null
  selectedSlot: number
}

/** The replay as the match page gives it: loading the match's art and timeline itself. */
export function ReplayWithArt({ insights, art, playbackPath, selectedSlot }: ReplayWithArtProps) {
  const legends = useLegends(art, playbackPath)

  return <ReviewReplay insights={insights} legends={legends} selectedSlot={selectedSlot} />
}

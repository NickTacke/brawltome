import type { MatchDetailContract } from '@brawltome/contracts'
import { loadReplay } from '@brawltome/replay-player'
import { createContext, useContext } from 'react'
import { getMatch } from '../../../server/replays'
import { drawMoment } from './draw-moment'

// what the stage loads the art and draws the legends with, and how it checks on art still being drawn. a page always
// uses the real ones; a test hands the stage its own through the context, as swapping the modules themselves would
// reach every other test in the run
export type StageTools = {
  loadReplay: typeof loadReplay
  drawMoment: typeof drawMoment
  readMatchArt: (matchId: string) => Promise<MatchDetailContract['art'] | null>
  artCheckEveryMs: number
}

const realTools: StageTools = {
  loadReplay,
  drawMoment,
  readMatchArt: async (matchId) => (await getMatch({ data: matchId }))?.art ?? null,
  artCheckEveryMs: 10_000,
}

export const StageToolsContext = createContext<StageTools>(realTools)

/** What the stage loads, draws and checks on its art with. */
export function useStageTools(): StageTools {
  return useContext(StageToolsContext)
}

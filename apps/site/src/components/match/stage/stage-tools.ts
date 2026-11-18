import { loadReplay } from '@brawltome/replay-player'
import { createContext, useContext } from 'react'
import { drawMoment } from './draw-moment'

// what the stage loads the art and draws the legends with. a page always uses the real ones; a test hands the stage
// its own through the context, as swapping the modules themselves would reach every other test in the run
export type StageTools = {
  loadReplay: typeof loadReplay
  drawMoment: typeof drawMoment
}

const realTools: StageTools = { loadReplay, drawMoment }

export const StageToolsContext = createContext<StageTools>(realTools)

/** The art loader and the moment drawer the stage uses. */
export function useStageTools(): StageTools {
  return useContext(StageToolsContext)
}

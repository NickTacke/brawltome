import type { MatchDetailContract } from '@brawltome/contracts'
import { useEffect, useState } from 'react'
import { useStageTools } from './stage-tools'

type Art = MatchDetailContract['art']

// checked every ten seconds, this is about five minutes; art that takes longer is shown on the next visit
const artChecks = 30

// a queued export that has a manifest from before already has art to show
function isBeingDrawn(art: Art): boolean {
  return art.state === 'queued' && !art.manifestUrl
}

/**
 * The match's art, checked on again every so often while the replay worker is still drawing it, so the legends show
 * up once they are in without the page reloading. A check that fails counts as one more check.
 */
export function useMatchArt(matchId: string, firstArt: Art): Art {
  const { readMatchArt, artCheckEveryMs } = useStageTools()
  const [art, setArt] = useState(firstArt)
  const isWaiting = isBeingDrawn(art)

  useEffect(() => {
    if (!isWaiting) return

    let isStopped = false
    let checksLeft = artChecks
    let timer = setTimeout(check, artCheckEveryMs)

    async function check() {
      checksLeft--

      const next = await readMatchArt(matchId).catch((error) => {
        console.error(`check the art of match ${matchId}:`, error)

        return null
      })

      if (isStopped) return

      if (next && !isBeingDrawn(next)) return setArt(next)

      if (checksLeft > 0) timer = setTimeout(check, artCheckEveryMs)
    }

    return () => {
      isStopped = true
      clearTimeout(timer)
    }
  }, [isWaiting, matchId, readMatchArt, artCheckEveryMs])

  return art
}

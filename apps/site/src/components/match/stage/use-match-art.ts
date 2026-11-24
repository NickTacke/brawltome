import type { MatchDetailContract } from '@brawltome/contracts'
import { useEffect, useState } from 'react'
import { useStageTools } from './stage-tools'

type Art = MatchDetailContract['art']

// checked every ten seconds, this is about five minutes. art can wait for hours behind other work, so after these the
// page goes on checking, only less often, for as long as it is open
const quickArtChecks = 30

// a queued export that has a manifest from before already has art to show
function isBeingDrawn(art: Art): boolean {
  return art.state === 'queued' && !art.manifestUrl
}

/**
 * The match's art, checked on again every so often while the replay worker is still drawing it, so the legends show
 * up once they are in without the page reloading. The first checks come quickly, the ones after them slowly, until
 * the art is in or has failed. A check that fails counts as one more check.
 */
export function useMatchArt(matchId: string, firstArt: Art): Art {
  const { readMatchArt, artCheckEveryMs, slowArtCheckEveryMs } = useStageTools()
  const [art, setArt] = useState(firstArt)
  const isWaiting = isBeingDrawn(art)

  useEffect(() => {
    if (!isWaiting) return

    let isStopped = false
    let checksMade = 0
    let timer = setTimeout(check, artCheckEveryMs)

    function nextCheckInMs(): number {
      return checksMade < quickArtChecks ? artCheckEveryMs : slowArtCheckEveryMs
    }

    async function check() {
      checksMade++

      const next = await readMatchArt(matchId).catch((error) => {
        console.error(`check the art of match ${matchId}:`, error)

        return null
      })

      if (isStopped) return

      if (next && !isBeingDrawn(next)) return setArt(next)

      timer = setTimeout(check, nextCheckInMs())
    }

    return () => {
      isStopped = true
      clearTimeout(timer)
    }
  }, [isWaiting, matchId, readMatchArt, artCheckEveryMs, slowArtCheckEveryMs])

  return art
}

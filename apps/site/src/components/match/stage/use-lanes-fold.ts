import { useLayoutEffect, useState } from 'react'

export const lanesFoldStorageKey = 'brawltome-replay-lanes'

// storage can be blocked or missing, as in a private window; the lanes then start unfolded on every page
function readIsFolded(): boolean {
  try {
    return window.localStorage.getItem(lanesFoldStorageKey) === 'folded'
  } catch {
    return false
  }
}

function storeIsFolded(isFolded: boolean) {
  try {
    if (isFolded) window.localStorage.setItem(lanesFoldStorageKey, 'folded')
    else window.localStorage.removeItem(lanesFoldStorageKey)
  } catch {
    // the choice then lasts as long as the page
  }
}

/**
 * Whether the viewer folded the lanes down to a thin bar, as they last left them on any match. The server can't
 * know, so the page first comes unfolded and folds them as soon as it runs.
 */
export function useLanesFold() {
  const [isFolded, setIsFolded] = useState(false)

  useLayoutEffect(() => setIsFolded(readIsFolded()), [])

  function toggle() {
    const next = !isFolded

    setIsFolded(next)
    storeIsFolded(next)
  }

  return { isFolded, toggle }
}

export type LanesFold = ReturnType<typeof useLanesFold>

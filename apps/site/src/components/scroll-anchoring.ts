type ScrollRoot = { style: { overflowAnchor: string } }

// a little longer than the 300ms show more transition
const panelAnimationMs = 400

let restoreTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Turns scroll anchoring off while a show more panel animates. With it on, a reader scrolled down to the footer sees
 * the browser scroll the page every frame to keep the button in place, instead of the rows opening below it.
 */
export function pauseScrollAnchoring(root: ScrollRoot = document.documentElement, durationMs = panelAnimationMs) {
  clearTimeout(restoreTimer)
  root.style.overflowAnchor = 'none'

  restoreTimer = setTimeout(() => {
    root.style.overflowAnchor = ''
  }, durationMs)
}

const viewportMarginPx = 8
// the space between the trigger and the panel, mt-1 on the panel
const panelGapPx = 4

// when the panel can't fit, its start edge wins so the first options stay reachable
export function viewportShiftPx(startPx: number, endPx: number, viewportSizePx: number): number {
  const shiftToStartPx = viewportMarginPx - startPx

  if (shiftToStartPx > 0) return shiftToStartPx

  const overflowEndPx = endPx - (viewportSizePx - viewportMarginPx)

  if (overflowEndPx <= 0) return 0

  return Math.max(-overflowEndPx, shiftToStartPx)
}

type PanelPlacement = { panelTopPx: number; panelBottomPx: number; triggerTopPx: number; viewportHeightPx: number }

// flips before it shifts, because a shifted panel can land under the cursor and take the click meant for the trigger
export function panelVerticalShiftPx({
  panelTopPx,
  panelBottomPx,
  triggerTopPx,
  viewportHeightPx,
}: PanelPlacement): number {
  const fitsBelow = panelBottomPx <= viewportHeightPx - viewportMarginPx

  if (fitsBelow) return viewportShiftPx(panelTopPx, panelBottomPx, viewportHeightPx)

  const panelHeightPx = panelBottomPx - panelTopPx
  const flippedTopPx = triggerTopPx - panelGapPx - panelHeightPx

  if (flippedTopPx >= viewportMarginPx) return flippedTopPx - panelTopPx

  return viewportShiftPx(panelTopPx, panelBottomPx, viewportHeightPx)
}

function wrapDown(currentIndex: number, optionCount: number, columns: number): number {
  const below = currentIndex + columns

  return below < optionCount ? below : currentIndex % columns
}

function wrapUp(currentIndex: number, optionCount: number, columns: number): number {
  const above = currentIndex - columns

  if (above >= 0) return above

  const column = Math.max(currentIndex, 0) % columns
  const lowestInColumn = Math.floor((optionCount - 1) / columns) * columns + column

  return lowestInColumn < optionCount ? lowestInColumn : Math.max(lowestInColumn - columns, column)
}

export function nextOptionIndex(
  key: string,
  currentIndex: number,
  optionCount: number,
  columns: number,
): number | null {
  if (key === 'Home') return 0

  if (key === 'End') return optionCount - 1

  if (key === 'ArrowDown') return wrapDown(currentIndex, optionCount, columns)

  if (key === 'ArrowUp') return wrapUp(currentIndex, optionCount, columns)

  if (columns === 1) return null

  if (key === 'ArrowRight') return (currentIndex + 1) % optionCount

  if (key === 'ArrowLeft') return (currentIndex - 1 + optionCount) % optionCount

  return null
}

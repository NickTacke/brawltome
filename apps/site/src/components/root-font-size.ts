/**
 * How many px one rem is right now. Sizes in the stylesheet follow the root font size, so a position worked out in px
 * from a size that css gives in rem has to scale with it.
 */
export function readRootFontSizePx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
}

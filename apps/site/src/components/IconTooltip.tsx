// the parent needs `group/tip relative`. a native title shows up late or not at all, so icons get a real tooltip
export const iconTooltipParent = 'group/tip relative'

// a parent at the edge of the page lines the tooltip up with its own edge, so the tooltip stays on screen
const alignments = {
  center: 'left-1/2 -translate-x-1/2',
  start: 'left-0',
  end: 'right-0',
}

// a parent at the bottom of the screen opens the tooltip above itself
const sides = {
  below: 'top-full mt-1',
  above: 'bottom-full mb-1',
}

type IconTooltipProps = { label: string; align?: keyof typeof alignments; side?: keyof typeof sides }

/** The name of an icon that has no visible label, shown below it on hover and keyboard focus. */
export function IconTooltip({ label, align = 'center', side = 'below' }: IconTooltipProps) {
  return (
    <span
      data-tooltip
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 rounded-sm border border-line bg-raised px-2 py-1 text-xs font-semibold whitespace-nowrap text-strong opacity-0 shadow-lg transition-opacity delay-100 group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100 ${sides[side]} ${alignments[align]}`}
    >
      {label}
    </span>
  )
}

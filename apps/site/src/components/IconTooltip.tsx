// the parent needs `group/tip relative`. a native title shows up late or not at all, so icons get a real tooltip
export const iconTooltipParent = 'group/tip relative'

/** The name of an icon that has no visible label, shown below it on hover and keyboard focus. */
export function IconTooltip({ label }: { label: string }) {
  return (
    <span
      data-tooltip
      aria-hidden="true"
      className="pointer-events-none absolute top-full left-1/2 z-10 mt-1 -translate-x-1/2 rounded-sm border border-line bg-raised px-2 py-1 text-xs font-semibold whitespace-nowrap text-strong opacity-0 shadow-lg transition-opacity delay-100 group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100"
    >
      {label}
    </span>
  )
}

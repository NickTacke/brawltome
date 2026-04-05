import type { ComponentPropsWithoutRef } from 'react'

type IconAdapterProps = ComponentPropsWithoutRef<'svg'> & { weight?: string }

/**
 * Outline variant of Tabler's IconHomeFilled with the door removed. Same
 * rounded-corner house silhouette (roof, walls, bottom) but without the door
 * notch - the bottom edge runs straight from the bottom-right rounded corner
 * to the bottom-left rounded corner. The `weight` prop is accepted for API
 * compatibility with Solar icons but ignored.
 */
export function HouseOutline({ weight: _weight, ...props }: IconAdapterProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Home</title>
      {/* House outline - bottom runs straight across (no door notch) */}
      <path d="M12.707 2.293l9 9c.63.63.184 1.707-.707 1.707h-1v6a3 3 0 0 1-3 3h-10a3 3 0 0 1-3-3v-6h-1c-.89 0-1.337-1.077-.707-1.707l9-9a1 1 0 0 1 1.414 0" />
      {/* Arched door, sitting on the house's bottom line */}
      <path d="M10 22V17a2 2 0 0 1 4 0v5" />
    </svg>
  )
}

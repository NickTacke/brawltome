import type { ComponentPropsWithoutRef } from 'react'

type IconAdapterProps = ComponentPropsWithoutRef<'svg'> & { weight?: string }

// takes weight so it fits beside the solar icons, but has only the one style
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
      <path d="M12.707 2.293l9 9c.63.63.184 1.707-.707 1.707h-1v6a3 3 0 0 1-3 3h-10a3 3 0 0 1-3-3v-6h-1c-.89 0-1.337-1.077-.707-1.707l9-9a1 1 0 0 1 1.414 0" />
      <path d="M10 22V17a2 2 0 0 1 4 0v5" />
    </svg>
  )
}

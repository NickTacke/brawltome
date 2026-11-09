import type { RoleGroup } from './roster'

export function RoleIcon({ group }: { group: RoleGroup }) {
  if (group === 'leader') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-current text-gold">
        <path d="M2 13V5l3.5 3L8 3l2.5 5L14 5v8z" />
      </svg>
    )
  }

  if (group === 'officer') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-current text-primary">
        <path d="M8 1.5 14 3.5v4.2c0 3.4-2.4 5.7-6 6.8-3.6-1.1-6-3.4-6-6.8V3.5z" />
      </svg>
    )
  }

  if (group === 'member') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-current text-text">
        <circle cx="8" cy="5" r="3" />
        <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5z" />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-3.5 fill-none stroke-current text-soft"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3 13.5c0-2.7 2.2-4.5 5-4.5s5 1.8 5 4.5z" strokeLinejoin="round" />
    </svg>
  )
}

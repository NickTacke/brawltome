import type { Point } from './callout-place'

type LeaderLineProps = { from: Point; to: Point; colour: string }

/** A line from a card to the player it is about; drawn twice, as a dark line under the coloured one keeps it readable on a bright stage. */
export function LeaderLine({ from, to, colour }: LeaderLineProps) {
  const ends = { x1: from.x, y1: from.y, x2: to.x, y2: to.y, strokeLinecap: 'round' as const }

  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
      <line {...ends} stroke="var(--color-ink)" strokeOpacity={0.7} strokeWidth={4} />
      <line {...ends} stroke={colour} strokeWidth={1.5} />
    </svg>
  )
}

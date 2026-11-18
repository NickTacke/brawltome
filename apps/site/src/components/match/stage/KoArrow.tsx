type KoArrowProps = { colour: string; turnDeg?: number; className?: string }

/** The way a player went out as a plain triangle, pointing up unless it is turned. */
export function KoArrow({ colour, turnDeg = 0, className = 'size-3' }: KoArrowProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} style={{ transform: `rotate(${turnDeg}deg)` }} aria-hidden="true">
      <path
        d="M6 1.5 L11 10.5 L1 10.5 Z"
        fill={colour}
        stroke="var(--color-ink)"
        strokeOpacity={0.7}
        strokeLinejoin="round"
      />
    </svg>
  )
}

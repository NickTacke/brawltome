const colourKey = 'mr-1.5 inline-block size-2 rounded-xs'

type WonAndLostProps = {
  won: number
  lost: number
  // a small square of each colour, said once, for what the bars' green and red are
  hasKey?: boolean
}

/** Openings won and lost in plain type, so the share above them leads. */
export function WonAndLost({ won, lost, hasKey = false }: WonAndLostProps) {
  return (
    <span className="text-soft">
      {hasKey ? <span className={`${colourKey} bg-emerald-400/85`} /> : null}
      <span className="font-semibold text-text">{won}</span> won
      <span className="mx-1.5">·</span>
      {hasKey ? <span className={`${colourKey} bg-red-400/70`} /> : null}
      <span className="font-semibold text-text">{lost}</span> lost
    </span>
  )
}

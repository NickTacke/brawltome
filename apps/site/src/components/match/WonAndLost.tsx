type WonAndLostProps = {
  won: number
  lost: number
  // the words in the bars' green and red, said once, for what those colours are
  hasKey?: boolean
}

/** Openings won and lost in plain type, so the share above them leads. */
export function WonAndLost({ won, lost, hasKey = false }: WonAndLostProps) {
  const wonWord = hasKey ? 'text-record-win' : ''
  const lostWord = hasKey ? 'text-record-loss' : ''

  return (
    <span className="text-soft">
      <span className="font-semibold text-text">{won}</span> <span className={wonWord}>won</span>
      <span className="mx-1.5">·</span>
      <span className="font-semibold text-text">{lost}</span> <span className={lostWord}>lost</span>
    </span>
  )
}

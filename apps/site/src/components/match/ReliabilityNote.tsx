import type { MatchDetailContract, MatchInsights } from '@brawltome/contracts'

type ReliabilityNoteProps = { match: MatchDetailContract; insights: MatchInsights }

/** A word that the numbers may be off, for a match whose line didn't pass every check against the game's counters. */
export function ReliabilityNote({ match, insights }: ReliabilityNoteProps) {
  // the match and its stored insights each keep the checks of the line they were read from, which may be older
  const isReliable = match.isReliable && insights.extras.isReliable

  if (isReliable) return null

  return (
    <p role="note" className="mt-3 text-sm text-soft">
      Some numbers in this match may be off: they didn&rsquo;t all check out against the game&rsquo;s own counters.
    </p>
  )
}

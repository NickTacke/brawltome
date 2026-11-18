import type { MatchDetailContract } from '@brawltome/contracts'

/** The stored replay file, to watch the match in the game itself, for a match whose file was kept. */
export function SaveReplay({ match }: { match: MatchDetailContract }) {
  if (!match.replay.available) return null

  return (
    <a
      href={`/match/${match.id}/replay`}
      download={match.replay.fileName}
      className="mt-3 inline-block text-sm font-semibold text-soft transition-colors hover:text-strong hover:underline"
    >
      Save replay
    </a>
  )
}

import { Play } from 'lucide-react'
import { useWatch } from './watch-moment'

/** Plays the match on the replay from a moment. Draws nothing on a page without a replay to play it on. */
export function WatchButton({ timeMs }: { timeMs: number }) {
  const watch = useWatch()

  if (!watch) return null

  return (
    <button
      type="button"
      onClick={() => watch(timeMs)}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-strong"
    >
      <Play className="size-3.5" aria-hidden="true" />
      Watch
    </button>
  )
}

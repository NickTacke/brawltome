import type { Opponent } from '../types'
import { useCursorForwarding } from '../hooks/useCursorForwarding'
import { open } from '@tauri-apps/plugin-shell'

interface OpponentCardProps {
  opponent: Opponent
}

export function OpponentCard({ opponent }: OpponentCardProps) {
  const { onMouseEnter, onMouseLeave } = useCursorForwarding()

  const playtimeDisplay = opponent.playtime >= 1000
    ? `${(opponent.playtime / 1000).toFixed(1)}k hrs`
    : `${Math.round(opponent.playtime)} hrs`

  return (
    <div
      className="rounded-lg bg-zinc-900/90 p-3 backdrop-blur"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">{opponent.name}</span>
        <span className="text-xs text-zinc-400">{opponent.region}</span>
      </div>

      <div className="mt-2 flex gap-4">
        <div>
          <p className="text-xs text-zinc-400">Elo</p>
          <p className="text-lg font-bold text-white">{opponent.rating}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-400">Peak</p>
          <p className="text-lg font-bold text-zinc-300">{opponent.peakRating}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-400">Playtime</p>
          <p className="text-lg font-bold text-white">{playtimeDisplay}</p>
        </div>
      </div>

      <div className="mt-1">
        <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">
          {opponent.tier}
        </span>
      </div>

      <button
        type="button"
        className="mt-3 w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
        onClick={() => {
          open(`https://brawltome.com/player/${opponent.brawlhallaId}`)
        }}
      >
        View Stats
      </button>
    </div>
  )
}

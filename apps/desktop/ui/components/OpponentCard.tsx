import { open } from '@tauri-apps/plugin-shell'
import type { Opponent } from '../types'
import { TierBadge } from './TierBadge'

interface OpponentCardProps {
  opponent: Opponent
  refreshing: boolean
}

function formatPlaytime(hours: number): string {
  return hours >= 1000 ? `${(hours / 1000).toFixed(1)}k hrs` : `${Math.round(hours)} hrs`
}

function winRateColor(rate: number): string {
  if (rate >= 55) return 'hsl(var(--overlay-success))'
  if (rate >= 45) return 'hsl(var(--overlay-muted-fg))'
  return 'hsl(var(--overlay-danger))'
}

export function OpponentCard({ opponent, refreshing }: OpponentCardProps) {
  const color = winRateColor(opponent.winRate)

  return (
    <div className="w-[300px] rounded-lg border border-[hsla(var(--overlay-border)/0.7)] bg-[hsla(var(--overlay-bg)/0.82)] p-2.5 backdrop-blur-[12px]">
      {/* Header: avatar + name/tier + link */}
      <div className="flex items-center gap-2">
        <div className="flex size-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] border-2 border-[hsl(var(--overlay-border))] bg-[hsl(var(--overlay-muted-bg))]">
          {opponent.legendKey ? (
            <img
              src={`/legends/${opponent.legendKey}.png`}
              alt={opponent.legendKey}
              className="size-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <span className="text-[14px] text-[hsl(var(--overlay-muted-fg))]">?</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-bold text-[hsl(var(--overlay-card-fg))]">
              {opponent.name}
            </span>
            <span className="rounded-full border border-[hsla(var(--overlay-border)/0.6)] bg-[hsla(var(--overlay-muted-bg)/0.8)] px-1.5 py-px font-mono text-[9px] font-medium text-[hsl(var(--overlay-fg))]">
              {opponent.region}
            </span>
          </div>
          <div className="mt-px flex items-center gap-1.5">
            <TierBadge tier={opponent.tier} />
            <span className="text-[10px] text-[hsl(var(--overlay-muted-fg))]">
              {formatPlaytime(opponent.playtime)}
            </span>
          </div>
        </div>

        {refreshing && (
          <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-[hsl(var(--overlay-muted-fg))] border-t-transparent" />
        )}

        <button
          type="button"
          className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded border border-[hsla(var(--overlay-border)/0.7)] text-[11px] text-white transition-colors hover:bg-[hsla(var(--overlay-muted-bg)/0.6)]"
          onClick={() => open(`https://brawltome.com/player/${opponent.brawlhallaId}`)}
        >
          ↗
        </button>
      </div>

      {/* Separator */}
      <div className="my-2 h-px bg-[hsla(var(--overlay-border)/0.5)]" />

      {/* Stats: elo / peak + WR bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-baseline">
          <span className="font-mono text-[18px] font-black tracking-tight text-[hsl(var(--overlay-card-fg))]">
            {opponent.rating}
          </span>
          <span className="mx-[5px] text-[12px] text-[hsl(213.3,15.1%,40%)]">/</span>
          <span className="font-mono text-[12px] font-bold text-[hsl(213.3,15.1%,50%)]">
            {opponent.peakRating}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wide text-[hsl(213.3,15.1%,45%)]">
            WR
          </span>
          <div className="h-[5px] w-[55px] overflow-hidden rounded-full bg-[hsla(var(--overlay-muted-bg)/0.8)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${opponent.winRate}%`, backgroundColor: color }}
            />
          </div>
          <span className="font-mono text-[11px] font-semibold" style={{ color }}>
            {opponent.winRate}%
          </span>
        </div>
      </div>
    </div>
  )
}

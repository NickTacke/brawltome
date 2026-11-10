export function WinBar({ wins, games }: { wins: number; games: number }) {
  const percent = games > 0 ? (wins / games) * 100 : 0

  return (
    <div data-winbar className="flex h-2 w-full gap-0.5" role="img" aria-label={`Won ${wins} of ${games}`}>
      <div className="rounded-l-full bg-emerald-400/85" style={{ width: `${percent}%` }} />
      <div className="flex-1 rounded-r-full bg-red-400/70" />
    </div>
  )
}

export function WinRateLabel() {
  return <span className="font-sans text-[0.6875rem] font-bold tracking-wide text-soft/75">WIN RATE:</span>
}

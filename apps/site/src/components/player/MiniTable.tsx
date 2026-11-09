export function MiniTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div data-mini-table className="w-[132px] shrink-0">
      {rows.map(({ label, value }) => (
        <div
          key={label}
          className="flex h-8 items-center justify-between gap-3 border-b border-line/30 text-sm last:border-b-0 xl:[@media(max-height:880px)]:h-7"
        >
          <span className="font-semibold whitespace-nowrap text-soft">{label}</span>
          <span className="font-black tracking-tight text-strong tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}

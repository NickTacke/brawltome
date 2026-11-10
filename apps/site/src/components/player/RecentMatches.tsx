const ghostStyle = 'block rounded-sm bg-white/[0.07]'

const ghostRows = [
  { name: '46%', detail: '28%', opacity: 1 },
  { name: '34%', detail: '22%', opacity: 0.8 },
  { name: '52%', detail: '30%', opacity: 0.6 },
  { name: '40%', detail: '20%', opacity: 0.4 },
  { name: '30%', detail: '26%', opacity: 0.22 },
]

export function RecentMatches() {
  return (
    <div data-recent-matches className="min-w-0">
      <div className="flex h-7 items-center justify-between gap-3 whitespace-nowrap">
        <h3 className="text-base font-bold text-strong">Recent matches</h3>
        <span className="text-xs font-semibold text-soft/80">Coming soon</span>
      </div>
      <ul className="mt-1" aria-hidden="true">
        {ghostRows.map(({ name, detail, opacity }, index) => (
          <li
            key={name}
            className={`flex h-[3.125rem] items-center gap-3 ${index > 2 ? 'max-xl:hidden' : ''}`}
            style={{ opacity }}
          >
            <img
              src="/images/legends/random.svg"
              alt=""
              className="size-9 shrink-0 rounded-md bg-white/[0.05] object-contain p-1 opacity-40"
            />
            <span className="min-w-0 flex-1 space-y-2">
              <span className={`${ghostStyle} h-2.5`} style={{ width: name }} />
              <span className={`${ghostStyle} h-2`} style={{ width: detail }} />
            </span>
            <span className={`${ghostStyle} h-3 w-9 shrink-0`} />
          </li>
        ))}
      </ul>
    </div>
  )
}

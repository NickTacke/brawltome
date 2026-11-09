import type { FilterOption } from './FilterSelect'

function Flag({ code }: { code: string }) {
  return <img src={`/images/flags/${code}.svg`} alt="" className="h-[18px] w-6 shrink-0 rounded-[2px] object-cover" />
}

// both coasts share a flag, so a corner badge tells them apart
function UsFlag({ side }: { side: 'E' | 'W' }) {
  return (
    <span className="relative block h-[18px] w-6 shrink-0">
      <img src="/images/flags/us.svg" alt="" className="size-full rounded-[2px] object-cover" />
      <span className="absolute -right-1.5 -bottom-1.5 flex size-4 items-center justify-center rounded-[3px] bg-ink text-[11px] leading-none font-black text-strong ring-1 ring-line">
        {side}
      </span>
    </span>
  )
}

function GlobalGlobe() {
  return (
    <span className="flex h-[18px] w-6 shrink-0 items-center justify-center">
      <img src="/images/flags/globe-world.svg" alt="" className="size-5" />
    </span>
  )
}

export const regionOptions: FilterOption[] = [
  { value: 'all', label: 'Global', flag: <GlobalGlobe /> },
  { value: 'US-E', label: 'US East', flag: <UsFlag side="E" /> },
  { value: 'US-W', label: 'US West', flag: <UsFlag side="W" /> },
  { value: 'EU', label: 'Europe', flag: <Flag code="eu" /> },
  { value: 'SEA', label: 'Southeast Asia', flag: <Flag code="sg" /> },
  { value: 'AUS', label: 'Australia', flag: <Flag code="au" /> },
  { value: 'BRZ', label: 'Brazil', flag: <Flag code="br" /> },
  { value: 'JPN', label: 'Japan', flag: <Flag code="jp" /> },
  { value: 'ME', label: 'Middle East', flag: <Flag code="bh" /> },
  { value: 'SA', label: 'South Africa', flag: <Flag code="za" /> },
]

export function regionOption(region: string | null): (typeof regionOptions)[number] | undefined {
  return regionOptions.find((option) => option.value === region)
}

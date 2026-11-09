import { legendAvatarUrl } from './legend-avatar-url'

export function LegendAvatar({ legend }: { legend: string | null }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-raised sm:size-7">
      <img src={legendAvatarUrl(legend)} alt="" loading="lazy" className="size-full object-cover object-top" />
    </span>
  )
}

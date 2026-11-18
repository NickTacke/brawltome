import { LoaderCircle } from 'lucide-react'

/** In the middle of the stage while something it draws is still loading. */
export function StageSpinner({ label }: { label: string }) {
  return (
    <span
      role="status"
      className="pointer-events-none absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink/70"
    >
      <LoaderCircle className="size-5 animate-spin text-strong" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

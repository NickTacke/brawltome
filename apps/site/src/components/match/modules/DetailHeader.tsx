import { X } from 'lucide-react'
import type { ReactNode } from 'react'

type DetailHeaderProps = { title: ReactNode; note?: ReactNode; onClose?: (() => void) | undefined }

/** The top row of a details panel, the same as on the player page's legend and weapon panels. */
export function DetailHeader({ title, note, onClose }: DetailHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-bold text-strong">{title}</div>
        {note && <div className="font-mono text-sm text-soft sm:truncate">{note}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="text-soft transition-colors hover:text-strong"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

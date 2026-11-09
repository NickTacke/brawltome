import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatWhole } from '../lib'

const defaultPageSize = 30

const arrowStyle =
  'flex size-8 items-center justify-center rounded-control text-soft transition-colors hover:bg-white/[0.04] hover:text-strong disabled:pointer-events-none disabled:opacity-30 sm:size-9'

export function pageRange(page: number, pageSize: number, total: number): { first: number; last: number } {
  if (total === 0) return { first: 0, last: 0 }

  return { first: (page - 1) * pageSize + 1, last: Math.min(page * pageSize, total) }
}

export function parsePageInput(value: string, pages: number): number | null {
  const requested = Number.parseInt(value, 10)

  if (Number.isNaN(requested) || requested < 1 || requested > pages) return null

  return requested
}

type PagerProps = {
  label: string
  page: number
  pages: number
  pageSize?: number
  total: number
  onPage: (page: number) => void
}

export function Pager({ label, page, pages, pageSize = defaultPageSize, total, onPage }: PagerProps) {
  const { first, last } = pageRange(page, pageSize, total)

  function jumpTo(value: string) {
    const requested = parsePageInput(value, pages)

    if (requested !== null) onPage(requested)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/50 pt-4">
      <span className="font-mono text-sm text-soft">
        {first}–{last} of {formatWhole(total)}
      </span>
      <nav aria-label={`${label} pages`} className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          className={arrowStyle}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="flex items-center gap-2 text-sm text-soft">
          Page
          {/* keyed on the page so the box shows the new number after an arrow press */}
          <input
            key={page}
            aria-label={`${label} page`}
            defaultValue={page}
            inputMode="numeric"
            onKeyDown={(event) => {
              if (event.key === 'Enter') jumpTo(event.currentTarget.value)
            }}
            className="h-8 w-10 rounded-control border border-line bg-transparent text-center font-mono text-text"
          />
          of <span className="font-mono">{pages}</span>
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className={arrowStyle}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </nav>
    </div>
  )
}

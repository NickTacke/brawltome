import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatWhole } from '../lib'
import { dropFocusBeforePress } from './drop-focus-before-press'

const defaultPageSize = 30

const arrowStyle =
  'flex size-8 items-center justify-center rounded-control text-soft transition-colors hover:bg-white/[0.04] hover:text-strong aria-disabled:pointer-events-none aria-disabled:opacity-30 sm:size-9'

export function pageRange(page: number, pageSize: number, total: number): { first: number; last: number } {
  const first = (page - 1) * pageSize + 1

  if (total === 0 || page < 1 || first > total) return { first: 0, last: 0 }

  return { first, last: Math.min(page * pageSize, total) }
}

export function parsePageInput(value: string, pages: number): number | null {
  const requested = Number.parseInt(value, 10)

  if (Number.isNaN(requested) || requested < 1 || requested > pages) return null

  return requested
}

export function previousPage(page: number, pages: number): number {
  return Math.min(page - 1, pages)
}

type ArrowProps = { label: string; isDisabled: boolean; onPress: () => void; children: React.ReactNode }

// aria-disabled, because a disabled button loses focus and a keyboard user would be sent back to the top of the page
function PagerArrow({ label, isDisabled, onPress, children }: ArrowProps) {
  function press() {
    if (!isDisabled) onPress()
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={isDisabled}
      onPointerDown={dropFocusBeforePress}
      onClick={press}
      className={arrowStyle}
    >
      {children}
    </button>
  )
}

type PageInputProps = { label: string; page: number; pages: number; onPage: (page: number) => void }

function PageInput({ label, page, pages, onPage }: PageInputProps) {
  const [draft, setDraft] = useState(String(page))

  useEffect(() => {
    setDraft(String(page))
  }, [page])

  function submit() {
    const requested = parsePageInput(draft, pages)

    if (requested === null || requested === page) {
      setDraft(String(page))

      return
    }

    onPage(requested)
  }

  return (
    <input
      aria-label={`${label} page`}
      value={draft}
      inputMode="numeric"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => setDraft(String(page))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit()
      }}
      className="h-8 w-10 rounded-control border border-line bg-transparent text-center font-mono text-text"
    />
  )
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

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/50 pt-4">
      <span className="font-mono text-sm text-soft">
        {formatWhole(first)}–{formatWhole(last)} of {formatWhole(total)}
      </span>
      <nav aria-label={`${label} pages`} className="flex items-center gap-2">
        <PagerArrow label="Previous page" isDisabled={page <= 1} onPress={() => onPage(previousPage(page, pages))}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </PagerArrow>
        <span className="flex items-center gap-2 text-sm text-soft">
          Page
          <PageInput label={label} page={page} pages={pages} onPage={onPage} />
          of <span className="font-mono">{formatWhole(Math.max(pages, 1))}</span>
        </span>
        <PagerArrow label="Next page" isDisabled={page >= pages} onPress={() => onPage(page + 1)}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </PagerArrow>
      </nav>
    </div>
  )
}

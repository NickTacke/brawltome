import { Search } from 'lucide-react'
import type { KeyboardEvent, RefObject } from 'react'

type SearchFieldProps = {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  isOpen: boolean
  isPanelShown: boolean
  isSearching: boolean
  onQuery: (query: string) => void
  onFocus: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

const fieldStyle =
  'h-12 w-full border bg-ink pr-12 pl-11 transition-colors placeholder:text-soft focus-visible:outline-none'

// the panel joins the field under one outline, so the field drops its bottom corners while it is open
const joinedStyle = 'rounded-t-control rounded-b-none border-soft/30'
const aloneStyle = 'rounded-control border-line focus:border-soft/50'

function FieldHint({ isOpen, isSearching }: { isOpen: boolean; isSearching: boolean }) {
  if (isSearching) {
    return (
      <span
        aria-hidden="true"
        className="absolute top-3.5 right-3 size-5 animate-spin rounded-full border-2 border-line border-t-soft"
      />
    )
  }

  if (isOpen) return null

  return (
    <kbd className="pointer-events-none absolute top-3 right-3 hidden size-6 items-center justify-center rounded-md border border-line font-mono text-xs text-soft md:flex">
      /
    </kbd>
  )
}

export function SearchField(props: SearchFieldProps) {
  const { inputRef, query, isOpen, isPanelShown, isSearching, onQuery, onFocus, onKeyDown } = props

  return (
    <label className="relative block">
      <span className="sr-only">Search players or guilds</span>
      <Search className="pointer-events-none absolute top-3.5 left-3 size-5 text-soft" aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={isPanelShown}
        aria-controls="search-results"
        aria-autocomplete="list"
        autoComplete="off"
        maxLength={100}
        spellCheck={false}
        placeholder="Search players or guilds..."
        className={`${fieldStyle} ${isPanelShown ? joinedStyle : aloneStyle}`}
      />
      <FieldHint isOpen={isOpen} isSearching={isSearching} />
    </label>
  )
}

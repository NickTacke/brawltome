import { useNavigate } from '@tanstack/react-router'
import { type FocusEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { SearchField } from './SearchField'
import { SearchPanel } from './SearchPanel'
import { enterTarget, type SearchTarget, searchTerm } from './search-keys'
import { usePageDim } from './use-page-dim'
import { useResultView } from './use-result-view'
import { useSearchResults } from './use-search-results'
import { useSlashFocus } from './use-slash-focus'

export function SearchBox() {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const answer = useSearchResults(query)
  const view = useResultView(answer.results)
  const isPanelShown = isOpen && searchTerm(query) !== null

  usePageDim(isOpen)
  useSlashFocus(inputRef)

  // keeps the highlighted row in sight when the arrow keys move past the panel's edge
  useEffect(() => {
    if (view.activeIndex < 0) return

    rootRef.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
  }, [view.activeIndex])

  function close() {
    setIsOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function open({ kind, id }: SearchTarget) {
    close()

    const to = kind === 'player' ? '/player/$id' : '/guild/$id'

    void navigate({ to, params: { id: String(id) } })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') close()

    if (event.key === 'Enter') {
      const target = enterTarget(query, view.highlighted)

      if (target) open(target)
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    view.move(event.key === 'ArrowDown' ? 1 : -1)
  }

  function closeWhenFocusLeaves(event: FocusEvent) {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) close()
  }

  return (
    // focus leaving any part of the search, field or result, closes it
    // biome-ignore lint/a11y/noStaticElementInteractions: blur bubbles up from the field and the result links
    <div ref={rootRef} onBlur={closeWhenFocusLeaves} className="relative z-50 mt-5 w-full max-w-xl">
      <SearchField
        inputRef={inputRef}
        query={query}
        isOpen={isOpen}
        isPanelShown={isPanelShown}
        isSearching={answer.status === 'searching'}
        onQuery={setQuery}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {isPanelShown && <SearchPanel answer={answer} view={view} query={query} onOpen={close} />}
    </div>
  )
}

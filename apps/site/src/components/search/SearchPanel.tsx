import { skeletonBarStyle } from '../table-styles'
import { SearchResultList } from './SearchResultList'
import type { ResultView } from './use-result-view'
import type { SearchAnswer } from './use-search-results'

type SearchPanelProps = { answer: SearchAnswer; view: ResultView; query: string; onOpen: (position: number) => void }

const loadingNameWidths = ['w-32', 'w-24', 'w-40']

function LoadingRows() {
  return (
    <div aria-busy="true">
      {loadingNameWidths.map((nameWidth) => (
        <div key={nameWidth} className="flex h-12 items-center justify-between gap-3 px-3 even:bg-black/[0.05]">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="size-8 shrink-0 animate-pulse rounded-md bg-white/[0.06]" />
            <span className={`${skeletonBarStyle} ${nameWidth}`} />
          </div>
          <span className={`${skeletonBarStyle} w-11`} />
        </div>
      ))}
    </div>
  )
}

function Message({ text }: { text: string }) {
  return <p className="px-3 py-6 text-center text-sm text-soft">{text}</p>
}

function PanelBody({ answer, view, query, onOpen }: SearchPanelProps) {
  const { status, results } = answer
  const hasResults = results.players.length + results.guilds.length > 0

  if (status === 'failed') return <Message text="Search failed. Try again in a moment." />

  if (hasResults) return <SearchResultList view={view} query={query} onOpen={onOpen} />

  if (status === 'done') return <Message text="No results" />

  return <LoadingRows />
}

export function SearchPanel(props: SearchPanelProps) {
  return (
    <div
      id="search-results"
      className="absolute top-full right-0 left-0 overflow-hidden rounded-b-control border-x border-b border-soft/30 bg-ink shadow-xl"
    >
      <PanelBody {...props} />
      <p className="border-t border-line/40 px-3 py-2 text-center text-xs text-soft">
        Not found? Press Enter to search by Brawlhalla ID
      </p>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { searchPlayersAndGuilds } from '../../server/search'
import { searchTerm } from './search-keys'
import { emptyResults, runSearch, type SearchAnswer, type SearchRun } from './search-run'
import { tabSearchReporter } from './tab-search-reporter'

export type { SearchAnswer, SearchStatus } from './search-run'

const debounceMs = 250
const idleAnswer: SearchAnswer = { status: 'idle', results: emptyResults }

/** Searches a moment after typing stops, and only keeps the answer for the latest text. */
export function useSearchResults(query: string): SearchAnswer {
  const [answer, setAnswer] = useState<SearchAnswer>(idleAnswer)

  useEffect(() => {
    const term = searchTerm(query)

    if (term === null) {
      setAnswer(idleAnswer)

      return
    }

    let isStale = false

    const run: SearchRun = {
      term,
      search: (text) => searchPlayersAndGuilds({ data: text }),
      nowMs: () => performance.now(),
      isStale: () => isStale,
      show: setAnswer,
      reporter: tabSearchReporter(),
    }

    // the last results stay up while the next ones load, so the rows don't flicker on every key
    setAnswer((current) => ({ status: 'searching', results: current.results }))

    const timer = setTimeout(() => void runSearch(run), debounceMs)

    return () => {
      isStale = true
      clearTimeout(timer)
    }
  }, [query])

  return answer
}

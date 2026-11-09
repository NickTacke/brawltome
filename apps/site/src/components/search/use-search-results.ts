import { useEffect, useState } from 'react'
import { type SearchResults, searchPlayersAndGuilds } from '../../server/search'
import { searchTerm } from './search-keys'

export type SearchStatus = 'idle' | 'searching' | 'done' | 'failed'
export type SearchAnswer = { status: SearchStatus; results: SearchResults }

const debounceMs = 250
const emptyResults: SearchResults = { players: [], guilds: [] }
const idleAnswer: SearchAnswer = { status: 'idle', results: emptyResults }

async function searchFor(term: string): Promise<SearchAnswer> {
  try {
    return { status: 'done', results: await searchPlayersAndGuilds({ data: term }) }
  } catch {
    return { status: 'failed', results: emptyResults }
  }
}

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

    function show(next: SearchAnswer) {
      if (!isStale) setAnswer(next)
    }

    // the last results stay up while the next ones load, so the rows don't flicker on every key
    setAnswer((current) => ({ status: 'searching', results: current.results }))

    const timer = setTimeout(() => void searchFor(term).then(show), debounceMs)

    return () => {
      isStale = true
      clearTimeout(timer)
    }
  }, [query])

  return answer
}

import type { SearchResults } from '../../server/search'
import type { SearchReporter } from './search-reporter'

export type SearchStatus = 'idle' | 'searching' | 'done' | 'failed'
export type SearchAnswer = { status: SearchStatus; results: SearchResults }

/** One search for a term, and what it needs from the page that asked. */
export type SearchRun = {
  term: string
  search: (term: string) => Promise<SearchResults>
  nowMs: () => number
  // newer text has replaced the term
  isStale: () => boolean
  show: (answer: SearchAnswer) => void
  // null for a visitor we may not count
  reporter: SearchReporter | null
}

export const emptyResults: SearchResults = { players: [], guilds: [] }

async function answerFor({ term, search }: SearchRun): Promise<SearchAnswer> {
  try {
    return { status: 'done', results: await search(term) }
  } catch {
    return { status: 'failed', results: emptyResults }
  }
}

function report({ term, reporter }: SearchRun, answer: SearchAnswer, latencyMs: number): void {
  if (!reporter) return

  if (answer.status === 'failed') {
    reporter.failed(latencyMs)

    return
  }

  reporter.performed(term, answer.results, latencyMs)
}

/**
 * Searches once and shows the answer, unless newer text replaced the term while it loaded. Only an answer that is
 * shown is reported, so typing on never counts as a search.
 */
export async function runSearch(run: SearchRun): Promise<void> {
  const startedAtMs = run.nowMs()
  const answer = await answerFor(run)
  const latencyMs = run.nowMs() - startedAtMs

  if (run.isStale()) return

  run.show(answer)
  report(run, answer, latencyMs)
}

import type { MatchList } from './matches-model'

// a list keeps every match the visitor has seen once they load more. the first page is reloaded while an upload is
// read, and a new match pushes its last one off; keeping what was seen leaves that match on the page instead of
// falling between the new first page and the next one loaded

/** What a list keeps after loading another page: everything it showed, then the new page. */
export function withNextPage(shown: MatchList, next: MatchList): MatchList {
  return { matches: [...shown.matches, ...next.matches], nextCursor: next.nextCursor }
}

/** The first page, then the kept matches it doesn't already show. */
export function joinPages(first: MatchList, kept: MatchList | null): MatchList {
  if (!kept) return first

  const onFirst = new Set(first.matches.map((match) => match.id))
  const rest = kept.matches.filter((match) => !onFirst.has(match.id))

  return { matches: [...first.matches, ...rest], nextCursor: kept.nextCursor }
}

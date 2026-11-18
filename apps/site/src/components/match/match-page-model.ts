import type { MatchDetailContract } from '@brawltome/contracts'

export type PageKind = 'review' | 'plain'

/** The review page needs the insights the api builds for stock 1v1 and 2v2 matches; any other match gets the plain page. */
export function pageKindOf(detail: MatchDetailContract): PageKind {
  return detail.insights ? 'review' : 'plain'
}

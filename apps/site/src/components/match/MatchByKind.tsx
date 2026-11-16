import type { MatchDetailContract } from '@brawltome/contracts'
import { MatchView } from '../matches/MatchView'
import { MatchPage } from './MatchPage'
import { pageKindOf } from './match-page-model'

/** The review page for a match it was designed for, the plain page for any other. */
export function MatchByKind({ match }: { match: MatchDetailContract }) {
  const { insights } = match

  // keyed by the match, so opening another one starts a new page: nothing of the last one's art, clock or camera stays
  if (pageKindOf(match) === 'review' && insights) return <MatchPage key={match.id} match={match} insights={insights} />

  return <MatchView match={match} />
}

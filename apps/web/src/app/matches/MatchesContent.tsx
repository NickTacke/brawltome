import { WorkInProgress } from '@/components/WorkInProgress'
import { matchesPreviewCookieAuthorized } from '@/lib/matches-preview'
import { MatchesPreview } from './MatchesPreview'
import { ReplayAnalysisPage } from './ReplayAnalysisPage'

export type MatchesPreviewQuery = {
  readonly analyze?: string | readonly string[]
  readonly match?: string | readonly string[]
  readonly player?: string | readonly string[]
}

function one(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function MatchesContent({
  previewCookie,
  query = {},
}: {
  previewCookie: string | undefined
  query?: MatchesPreviewQuery
}) {
  if (!matchesPreviewCookieAuthorized(previewCookie)) return <WorkInProgress slug="matches" />
  if (one(query.analyze) === '1') return <ReplayAnalysisPage />

  const matchId = one(query.match)
  const playerId = one(query.player)
  if (matchId && playerId) return <MatchesPreview notice="Choose one preview view at a time." />
  return <MatchesPreview matchId={matchId} playerId={playerId} />
}

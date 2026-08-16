import { WorkInProgress } from '@/components/WorkInProgress'
import { matchesPreviewCookieAuthorized } from '@/lib/matches-preview'
import { ReplayAnalysisPage } from './ReplayAnalysisPage'

export function MatchesContent({ previewCookie }: { previewCookie: string | undefined }) {
  return matchesPreviewCookieAuthorized(previewCookie) ? <ReplayAnalysisPage /> : <WorkInProgress slug="matches" />
}

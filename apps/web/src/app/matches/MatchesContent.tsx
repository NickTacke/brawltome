import { WorkInProgress } from '@/components/WorkInProgress'
import { matchesPreviewCookieAuthorized } from '@/lib/matches-preview'
import { EventlineDemo } from './EventlineDemo'
import { ReplayAnalysisPage } from './ReplayAnalysisPage'

export function MatchesContent({
  previewCookie,
  demo = false,
}: {
  previewCookie: string | undefined
  demo?: boolean
}) {
  if (!matchesPreviewCookieAuthorized(previewCookie)) return <WorkInProgress slug="matches" />
  return demo ? <EventlineDemo /> : <ReplayAnalysisPage />
}

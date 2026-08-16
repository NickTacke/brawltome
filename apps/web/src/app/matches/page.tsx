import { matchesPreviewCookieName } from '@/lib/matches-preview'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { MatchesContent } from './MatchesContent'

export const metadata: Metadata = {
  title: 'Matches - Coming Soon',
}

export default async function Page() {
  return <MatchesContent previewCookie={(await cookies()).get(matchesPreviewCookieName)?.value} />
}

import { matchesPreviewCookieName } from '@/lib/matches-preview'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { MatchesContent } from './MatchesContent'

export const metadata: Metadata = {
  title: 'Matches',
}

interface PageProps {
  searchParams: Promise<{ demo?: string | string[] }>
}

export default async function Page({ searchParams }: PageProps) {
  const query = await searchParams
  const cookieStore = await cookies()
  return <MatchesContent previewCookie={cookieStore.get(matchesPreviewCookieName)?.value} demo={query.demo === '1'} />
}

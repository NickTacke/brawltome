import { matchesPreviewCookieName } from '@/lib/matches-preview'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { MatchesContent } from './MatchesContent'

export const metadata: Metadata = {
  title: 'Matches',
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function Page({ searchParams }: PageProps) {
  const [cookieStore, query] = await Promise.all([cookies(), searchParams])
  return <MatchesContent previewCookie={cookieStore.get(matchesPreviewCookieName)?.value} query={query} />
}

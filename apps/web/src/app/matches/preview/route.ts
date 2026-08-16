import {
  matchesPreviewCookieName,
  matchesPreviewCookieValue,
  matchesPreviewInviteAuthorized,
} from '@/lib/matches-preview'
import { type NextRequest, NextResponse } from 'next/server'

export function GET(request: NextRequest) {
  const url = request.nextUrl
  const destination = url.clone()
  destination.pathname = '/matches'
  destination.search = ''
  const response = NextResponse.redirect(destination)
  response.headers.set('cache-control', 'no-store')
  if (!matchesPreviewInviteAuthorized(url.searchParams.get('token'))) return response

  const cookie = matchesPreviewCookieValue()
  if (!cookie) return response
  response.cookies.set(matchesPreviewCookieName, cookie, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: '/matches',
    sameSite: 'strict',
    secure: true,
  })
  return response
}

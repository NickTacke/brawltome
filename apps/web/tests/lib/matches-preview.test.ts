import { afterEach, describe, expect, test } from 'bun:test'
import { MatchesContent } from '@/app/matches/MatchesContent'
import { ReplayAnalysisPage } from '@/app/matches/ReplayAnalysisPage'
import { GET } from '@/app/matches/preview/route'
import { WorkInProgress } from '@/components/WorkInProgress'
import { matchesPreviewCookieAuthorized, matchesPreviewCookieName } from '@/lib/matches-preview'
import { NextRequest } from 'next/server'

const previousToken = process.env.MATCHES_PREVIEW_TOKEN
const token = 'matches-preview-test-token-at-least-32-bytes'

afterEach(() => {
  if (previousToken === undefined) Reflect.deleteProperty(process.env, 'MATCHES_PREVIEW_TOKEN')
  else process.env.MATCHES_PREVIEW_TOKEN = previousToken
})

describe('matches preview invite', () => {
  test('exchanges a valid invite token for an HttpOnly access cookie', () => {
    process.env.MATCHES_PREVIEW_TOKEN = token

    const response = GET(new NextRequest(`https://brawltome.app/matches/preview?token=${token}`))
    const setCookie = response.headers.get('set-cookie') ?? ''
    const cookieValue = setCookie.split(';')[0]?.slice(`${matchesPreviewCookieName}=`.length)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://brawltome.app/matches')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Max-Age=2592000')
    expect(setCookie).toContain('Path=/matches')
    expect(setCookie).toContain('SameSite=strict')
    expect(setCookie).toContain('Secure')
    expect(setCookie).not.toContain(token)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(matchesPreviewCookieAuthorized(cookieValue)).toBe(true)
    expect(MatchesContent({ previewCookie: cookieValue }).type).toBe(ReplayAnalysisPage)
  })

  test('does not grant access for an invalid invite', () => {
    process.env.MATCHES_PREVIEW_TOKEN = token

    const response = GET(new NextRequest('https://brawltome.app/matches/preview?token=invalid'))

    expect(response.headers.has('set-cookie')).toBe(false)
    expect(matchesPreviewCookieAuthorized(undefined)).toBe(false)
    expect(MatchesContent({ previewCookie: undefined }).type).toBe(WorkInProgress)
  })

  test('fails closed when the preview token is absent or too short', () => {
    Reflect.deleteProperty(process.env, 'MATCHES_PREVIEW_TOKEN')
    expect(GET(new NextRequest(`https://brawltome.app/matches/preview?token=${token}`)).headers.has('set-cookie')).toBe(
      false,
    )
    process.env.MATCHES_PREVIEW_TOKEN = 'too-short'
    expect(matchesPreviewCookieAuthorized(undefined)).toBe(false)
    expect(MatchesContent({ previewCookie: undefined }).type).toBe(WorkInProgress)
  })
})

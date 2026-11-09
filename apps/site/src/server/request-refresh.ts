import '@tanstack/react-start/server-only'
import { type RefreshOutcomeContract, visitorRefreshResponseSchema } from '@brawltome/contracts'
import type { RefreshAnswer } from '../components/refresh/refresh-answer'
import { postApi } from './api'
import { failureText } from './optional-read'
import type { Visitor } from './visitor-headers'

export type RefreshTarget = 'players' | 'clans'

export type RefreshRequest = { id: number; turnstileToken?: string }

// the wait the api itself gives when it can't take a refresh
const unavailable: RefreshAnswer = { kind: 'unavailable', retryAfterSeconds: 30 }

function toAnswer(refresh: RefreshOutcomeContract): RefreshAnswer {
  switch (refresh.outcome) {
    case 'accepted':
    case 'alreadyRefreshing':
      return { kind: 'refreshing', pollAfterSeconds: refresh.retry.afterSeconds }
    case 'notNeeded':
      return { kind: 'fresh' }
    case 'verificationRequired':
      // public by design, the browser needs it to show the challenge
      return { kind: 'verify', siteKey: process.env.TURNSTILE_SITE_KEY || null }
    case 'rateLimited':
      return { kind: 'refused', retryAfterSeconds: refresh.retry.afterSeconds }
    case 'temporarilyUnavailable':
      return { kind: 'unavailable', retryAfterSeconds: refresh.retry.afterSeconds }
  }
}

/** Asks the api to refresh a stale player or clan for this visitor. Never throws, the page is already on screen. */
export async function requestRefresh(
  target: RefreshTarget,
  { id, turnstileToken }: RefreshRequest,
  visitor: Visitor,
): Promise<RefreshAnswer> {
  const body = { turnstileToken, refreshTrust: visitor.refreshTrust }
  const description = `refresh ${target === 'players' ? 'player' : 'guild'} ${id} for a visitor`

  try {
    const answer = await postApi(`/${target}/${id}/refresh`, body, visitorRefreshResponseSchema, description, {
      headers: visitor.headers,
    })

    if (answer.refreshTrust) visitor.keepRefreshTrust(answer.refreshTrust)

    return toAnswer(answer.refresh)
  } catch (error) {
    console.error(failureText(error))

    return unavailable
  }
}

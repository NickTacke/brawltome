import '@tanstack/react-start/server-only'
import {
  type MyMatchesContract,
  myMatchesSchema,
  type RecentMatchesContract,
  recentMatchesSchema,
} from '@brawltome/contracts'
import { readApi } from './api'

// the match lists the matches page shows: everyone's latest uploads, and the matches the visitor played in

function pagePath(path: string, cursor: string | undefined): string {
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path
}

function visitorHeaders(sessionToken: string | undefined) {
  return sessionToken ? { headers: { 'x-visitor-session': sessionToken } } : {}
}

/** Every uploaded match, newest first; the visitor's session decides whether they may see replays yet. */
export function loadRecentMatches(sessionToken: string | undefined, cursor?: string): Promise<RecentMatchesContract> {
  const path = pagePath('/matches', cursor)

  return readApi(path, recentMatchesSchema, 'load recent matches', visitorHeaders(sessionToken))
}

/** The matches the visitor's verified player played in, with their record over all of them. */
export function loadMyMatches(sessionToken: string, cursor?: string): Promise<MyMatchesContract> {
  const path = pagePath('/me/matches', cursor)

  return readApi(path, myMatchesSchema, 'load your matches', visitorHeaders(sessionToken))
}

import '@tanstack/react-start/server-only'
import { getRequestHeader } from '@tanstack/react-start/server'
import type { AccountWriteRequest } from './account-writes'
import { isSameOriginRequest } from './same-origin'
import { currentSession } from './session-cookie'

/** The visitor's session for a write, and whether a page of this site sent it. */
export function currentWriteRequest(): AccountWriteRequest {
  const source = {
    fetchSite: getRequestHeader('sec-fetch-site'),
    origin: getRequestHeader('origin'),
    host: getRequestHeader('host'),
  }

  return { session: currentSession(), isSameOrigin: isSameOriginRequest(source) }
}

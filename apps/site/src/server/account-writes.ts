import '@tanstack/react-start/server-only'
import {
  type AccountPinnedPlayersContract,
  accountPinnedPlayersSchema,
  accountSignOutSchema,
} from '@brawltome/contracts'
import type { PinWriteAnswer, SignOutAnswer } from '../components/account/account-model'
import { writeApi } from './api'
import { failureText } from './optional-read'
import type { VisitorSession } from './session-cookie'

/** A write as the server function sees it: the visitor's session, and whether a page of this site sent it. */
export type AccountWriteRequest = {
  session: Pick<VisitorSession, 'token' | 'drop'>
  isSameOrigin: boolean
}

type PinWrite = (sessionHeaders: { headers: Record<string, string> }) => Promise<AccountPinnedPlayersContract>

// with the session cookie a write from another site would act as the visitor, so it never reaches the api
function refusesRequest(request: AccountWriteRequest, description: string): boolean {
  if (request.isSameOrigin) return false

  console.error(`${description}: refused a request from another site`)

  return true
}

async function writePins(request: AccountWriteRequest, description: string, write: PinWrite): Promise<PinWriteAnswer> {
  if (refusesRequest(request, description)) return { kind: 'failed' }

  if (!request.session.token) return { kind: 'signedOut' }

  try {
    const pins = await write({ headers: { 'x-visitor-session': request.session.token } })

    return { kind: 'saved', pinOrder: pins.map(({ brawlhallaId }) => brawlhallaId) }
  } catch (error) {
    console.error(failureText(error))

    return { kind: 'failed' }
  }
}

export function unpinForVisitor(brawlhallaId: number, request: AccountWriteRequest): Promise<PinWriteAnswer> {
  const description = `unpin player ${brawlhallaId}`
  const path = `/account/pinned-players/${brawlhallaId}`

  return writePins(request, description, (options) =>
    writeApi('DELETE', path, undefined, accountPinnedPlayersSchema, description, options),
  )
}

export function reorderPinsForVisitor(brawlhallaIds: number[], request: AccountWriteRequest): Promise<PinWriteAnswer> {
  const description = 'reorder pinned players'
  const body = { brawlhallaIds }

  return writePins(request, description, (options) =>
    writeApi('PUT', '/account/pinned-players', body, accountPinnedPlayersSchema, description, options),
  )
}

/** Ends the session on the api, then clears the cookie. When the api fails the cookie stays, like on the old site. */
export async function signOutVisitor(request: AccountWriteRequest): Promise<SignOutAnswer> {
  const description = 'sign out'

  if (refusesRequest(request, description)) return { kind: 'failed' }

  if (!request.session.token) return { kind: 'signedOut' }

  try {
    const options = { headers: { 'x-visitor-session': request.session.token } }

    await writeApi('POST', '/account/sign-out', {}, accountSignOutSchema, description, options)
  } catch (error) {
    console.error(failureText(error))

    return { kind: 'failed' }
  }

  request.session.drop()

  return { kind: 'signedOut' }
}

import '@tanstack/react-start/server-only'
import {
  type AccountPinnedPlayersContract,
  accountPinnedPlayersSchema,
  accountSessionSchema,
  nullablePlayerRankedProfileSchema,
  nullablePlayerReferenceSchema,
  type PrimaryPlayerVerificationStateContract,
  primaryPlayerVerificationStateSchema,
} from '@brawltome/contracts'
import {
  type AccountPage,
  type PlayerFacts,
  toPinnedPlayerRow,
  toVerification,
} from '../components/account/account-model'
import { accountLinks } from './account-links'
import { readApi } from './api'
import { failureText, optionalRead, readOptional } from './optional-read'
import type { VisitorSession } from './session-cookie'

// as many player reads at once as the old account page made
const playerReadsAtOnce = 5

export type AccountSession = Pick<VisitorSession, 'token' | 'keepUntil'>

function sessionHeaders(sessionToken: string) {
  return { headers: { 'x-visitor-session': sessionToken } }
}

function readAccountParts(
  sessionToken: string,
): Promise<[AccountPinnedPlayersContract, PrimaryPlayerVerificationStateContract]> {
  const description = 'load account'

  return Promise.all([
    readApi('/account/pinned-players', accountPinnedPlayersSchema, description, sessionHeaders(sessionToken)),
    readApi('/account/primary-player', primaryPlayerVerificationStateSchema, description, sessionHeaders(sessionToken)),
  ])
}

// the facts only decorate a row, so a pin whose player can't be read still shows
async function readPlayerFacts(brawlhallaId: number): Promise<PlayerFacts> {
  const description = `load pinned player ${brawlhallaId}`
  const referencePath = `/players/${brawlhallaId}/reference`
  const rankedPath = `/players/${brawlhallaId}/ranked`
  const readReference = () => readApi(referencePath, nullablePlayerReferenceSchema, description, optionalRead)
  const readRanked = () => readApi(rankedPath, nullablePlayerRankedProfileSchema, description, optionalRead)

  const [reference, ranked] = await Promise.all([readOptional(readReference, null), readOptional(readRanked, null)])

  return { reference, ranked }
}

async function readFactsById(brawlhallaIds: number[]): Promise<Map<number, PlayerFacts>> {
  const factsById = new Map<number, PlayerFacts>()

  for (let start = 0; start < brawlhallaIds.length; start += playerReadsAtOnce) {
    const batch = brawlhallaIds.slice(start, start + playerReadsAtOnce)
    const batchFacts = await Promise.all(batch.map(readPlayerFacts))

    for (const [index, brawlhallaId] of batch.entries()) factsById.set(brawlhallaId, batchFacts[index])
  }

  return factsById
}

async function loadSignedInParts(sessionToken: string) {
  const [pins, verificationState] = await readAccountParts(sessionToken)
  const primaryId = verificationState.primaryPlayer?.brawlhallaId ?? null
  const pinOrder = pins.map(({ brawlhallaId }) => brawlhallaId)
  const playerIds = [...new Set(primaryId === null ? pinOrder : [primaryId, ...pinOrder])]
  const factsById = await readFactsById(playerIds)

  const otherPins = pinOrder
    .filter((brawlhallaId) => brawlhallaId !== primaryId)
    .map((brawlhallaId) => toPinnedPlayerRow(brawlhallaId, factsById.get(brawlhallaId)))

  return { verification: toVerification(verificationState, factsById), pins: otherPins, pinOrder }
}

export type SignedInParts = Omit<Extract<AccountPage, { kind: 'signedIn' }>, 'kind' | 'verifySteamUrl'>

/** The visitor's account with the verified account and pins, or null without a session the api accepts. */
export async function readSignedInAccount(session: AccountSession): Promise<SignedInParts | null> {
  if (!session.token) return null

  const current = await readApi('/account', accountSessionSchema, 'load account', sessionHeaders(session.token))

  if (current.status === 'anonymous') return null

  session.keepUntil(new Date(current.sessionExpiresAt))

  const { displayName, avatarUrl, createdAt } = current.account
  const parts = await loadSignedInParts(session.token)

  return { account: { displayName, avatarUrl, createdAt }, ...parts }
}

async function loadAccountOrThrow(session: AccountSession): Promise<AccountPage> {
  const links = accountLinks(process.env.PUBLIC_API_URL)
  const signedIn = await readSignedInAccount(session)

  if (!signedIn) return { kind: 'signedOut', signInUrl: links.signIn }

  return { kind: 'signedIn', ...signedIn, verifySteamUrl: links.verifySteam }
}

/** The account page for the visitor's session, which the api checks on every read. */
export async function loadAccount(session: AccountSession): Promise<AccountPage> {
  try {
    return await loadAccountOrThrow(session)
  } catch (error) {
    console.error(failureText(error))

    // thrown messages reach the page's html, so the detail only goes to the server log
    throw new Error('load account: the account could not be read')
  }
}

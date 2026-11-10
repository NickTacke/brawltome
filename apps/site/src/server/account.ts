import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
  type AccountWriteRequest,
  pinForVisitor,
  reorderPinsForVisitor,
  signOutVisitor,
  unpinForVisitor,
} from './account-writes'
import { loadAccount } from './load-account'
import { loadRailAccount } from './load-rail-account'
import { isSameOriginRequest } from './same-origin'
import { currentSession } from './session-cookie'

const brawlhallaIdSchema = z.number().int().positive().max(2_147_483_647)
// the api's own ceiling for an order, which keeps legacy accounts above the pin limit able to reorder
const pinOrderSchema = z.array(brawlhallaIdSchema).max(100)

function currentWriteRequest(): AccountWriteRequest {
  const source = {
    fetchSite: getRequestHeader('sec-fetch-site'),
    origin: getRequestHeader('origin'),
    host: getRequestHeader('host'),
  }

  return { session: currentSession(), isSameOrigin: isSameOriginRequest(source) }
}

export const getAccount = createServerFn({ method: 'GET' }).handler(() => {
  // one visitor's account, so no cache between the browser and the site may keep it
  setResponseHeader('cache-control', 'private, no-store')

  return loadAccount(currentSession())
})

// after hydration on every page, so a visitor without the session cookie gets an answer without an api call
export const getRailAccount = createServerFn({ method: 'GET' }).handler(() => {
  setResponseHeader('cache-control', 'private, no-store')

  return loadRailAccount(currentSession())
})

export const pinAccountPlayer = createServerFn({ method: 'POST' })
  .validator(brawlhallaIdSchema)
  .handler(({ data: brawlhallaId }) => pinForVisitor(brawlhallaId, currentWriteRequest()))

export const unpinAccountPlayer = createServerFn({ method: 'POST' })
  .validator(brawlhallaIdSchema)
  .handler(({ data: brawlhallaId }) => unpinForVisitor(brawlhallaId, currentWriteRequest()))

export const reorderAccountPins = createServerFn({ method: 'POST' })
  .validator(pinOrderSchema)
  .handler(({ data: brawlhallaIds }) => reorderPinsForVisitor(brawlhallaIds, currentWriteRequest()))

export const signOutAccount = createServerFn({ method: 'POST' }).handler(() => signOutVisitor(currentWriteRequest()))

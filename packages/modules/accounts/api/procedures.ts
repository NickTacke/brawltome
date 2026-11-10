import {
  accountPinnedPlayersSchema,
  accountSessionSchema,
  accountSignOutSchema,
  pinnedPlayerInputSchema,
  pinnedPlayerOrderInputSchema,
  primaryPlayerVerificationStateSchema,
} from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { ORPCError } from '@orpc/server'
import { type Account, type Accounts, createAccounts, InvalidPinnedPlayerError } from '../src/accounts'
import { createPostgresAccountsStore } from '../src/postgres-store'
import { toAccountPinnedPlayers, toAccountSession, toVerificationState } from './account-contracts'

// the site never names an account: every call carries the visitor's session token, and this checks it each time
async function requireAccount(accounts: Accounts, sessionToken: string | undefined): Promise<Account> {
  const authentication = await accounts.authenticate(sessionToken ?? null)

  if (authentication.status === 'anonymous') throw new ORPCError('UNAUTHORIZED')

  return authentication.account
}

async function asBadRequest<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof InvalidPinnedPlayerError) throw new ORPCError('BAD_REQUEST', { message: error.message })

    throw error
  }
}

/** The account reads and writes the site makes for its visitor, at /rpc/accounts/* and /v1. Internal callers only. */
export function createAccountProcedures(runtime: ModuleRuntime) {
  const { store } = createPostgresAccountsStore(runtime.database)
  const accounts = createAccounts({ store })

  const current = internalProcedure
    .route({ method: 'GET', path: '/account', operationId: 'accounts.current', summary: 'Account', tags: ['accounts'] })
    .output(accountSessionSchema)
    .handler(async ({ context }) => toAccountSession(await accounts.authenticate(context.visitorSessionToken ?? null)))

  const pinnedPlayers = internalProcedure
    .route({
      method: 'GET',
      path: '/account/pinned-players',
      operationId: 'accounts.pinnedPlayers',
      summary: 'Pinned players',
      tags: ['accounts'],
    })
    .output(accountPinnedPlayersSchema)
    .handler(async ({ context }) => {
      const account = await requireAccount(accounts, context.visitorSessionToken)

      return toAccountPinnedPlayers(await accounts.getPinnedPlayers(account.id))
    })

  const primaryPlayer = internalProcedure
    .route({
      method: 'GET',
      path: '/account/primary-player',
      operationId: 'accounts.primaryPlayer',
      summary: 'Verified Brawlhalla account',
      tags: ['accounts'],
    })
    .output(primaryPlayerVerificationStateSchema)
    .handler(async ({ context }) => {
      const account = await requireAccount(accounts, context.visitorSessionToken)

      return toVerificationState(await accounts.getPrimaryPlayerVerificationState(account.id))
    })

  // pinning a player already pinned keeps the order; the store refuses a pin past the limit
  const pinPlayer = internalProcedure
    .route({
      method: 'POST',
      path: '/account/pinned-players',
      operationId: 'accounts.pinPlayer',
      summary: 'Pin a player',
      tags: ['accounts'],
    })
    .input(pinnedPlayerInputSchema)
    .output(accountPinnedPlayersSchema)
    .handler(async ({ context, input }) => {
      const account = await requireAccount(accounts, context.visitorSessionToken)

      await asBadRequest(() => accounts.pinPlayer(account.id, input.brawlhallaId))

      return toAccountPinnedPlayers(await accounts.getPinnedPlayers(account.id))
    })

  const unpinPlayer = internalProcedure
    .route({
      method: 'DELETE',
      path: '/account/pinned-players/{brawlhallaId}',
      operationId: 'accounts.unpinPlayer',
      summary: 'Unpin a player',
      tags: ['accounts'],
    })
    .input(pinnedPlayerInputSchema)
    .output(accountPinnedPlayersSchema)
    .handler(async ({ context, input }) => {
      const account = await requireAccount(accounts, context.visitorSessionToken)

      await accounts.unpinPlayer(account.id, input.brawlhallaId)

      return toAccountPinnedPlayers(await accounts.getPinnedPlayers(account.id))
    })

  const reorderPinnedPlayers = internalProcedure
    .route({
      method: 'PUT',
      path: '/account/pinned-players',
      operationId: 'accounts.reorderPinnedPlayers',
      summary: 'Reorder pinned players',
      tags: ['accounts'],
    })
    .input(pinnedPlayerOrderInputSchema)
    .output(accountPinnedPlayersSchema)
    .handler(async ({ context, input }) => {
      const account = await requireAccount(accounts, context.visitorSessionToken)
      const reorder = () => accounts.reorderPinnedPlayers(account.id, input.brawlhallaIds)

      return toAccountPinnedPlayers(await asBadRequest(reorder))
    })

  // like the old /auth/signout: the session ends even if it already expired, and no session is nothing to end
  const signOut = internalProcedure
    .route({
      method: 'POST',
      path: '/account/sign-out',
      operationId: 'accounts.signOut',
      summary: 'End the session',
      tags: ['accounts'],
    })
    .output(accountSignOutSchema)
    .handler(async ({ context }) => {
      if (context.visitorSessionToken) await accounts.signOut(context.visitorSessionToken)

      return { status: 'signedOut' as const }
    })

  return { current, pinnedPlayers, primaryPlayer, pinPlayer, unpinPlayer, reorderPinnedPlayers, signOut }
}

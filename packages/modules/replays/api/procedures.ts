import { type Accounts, createPostgresAccounts } from '@brawltome/accounts'
import {
  matchDetailSchema,
  matchIdSchema,
  myReplaysSchema,
  playerMatchesInputSchema,
  playerMatchesSchema,
  replayAccessSchema,
  replayUploadInputSchema,
  replayUploadResultSchema,
} from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime, type ObjectStore } from '@brawltome/foundation'
import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { getMatch, getReplayFile, listMyReplays, listPlayerMatches } from '../reads'
import { uploadReplays } from '../upload'

const tags = ['replays']

// the site calls these for its visitor; key holders of the public api will get the same procedures later
export function createReplayProcedures(runtime: ModuleRuntime) {
  const { accounts } = createPostgresAccounts(runtime.database)
  const operators = new Set(runtime.replayOperatorAccountIds ?? [])
  const isOpen = runtime.replaysOpen ?? false

  // until replays open to everyone, only operators see anything; to others the pages don't exist yet
  async function canSee(sessionToken: string | undefined): Promise<boolean> {
    if (isOpen) return true

    const authentication = await accounts.authenticate(sessionToken ?? null)

    return authentication.status !== 'anonymous' && operators.has(authentication.account.id)
  }

  async function requireSight(sessionToken: string | undefined, code: 'NOT_FOUND' | 'FORBIDDEN'): Promise<void> {
    if (!(await canSee(sessionToken))) throw new ORPCError(code)
  }

  function objectStore(): ObjectStore {
    if (!runtime.objectStore) throw new Error('replays need an object store, and this process has none')

    return runtime.objectStore
  }

  const upload = internalProcedure
    .route({ method: 'POST', path: '/replays', operationId: 'replays.upload', summary: 'Upload replays', tags })
    .input(replayUploadInputSchema)
    .output(replayUploadResultSchema)
    .handler(async ({ context, input }) => {
      const account = await requireAccount(accounts, context.visitorSessionToken)

      await requireSight(context.visitorSessionToken, 'FORBIDDEN')

      const isOperator = operators.has(account.id)

      if (!isOperator && !(await hasVerifiedPlayer(accounts, account.id))) {
        throw new ORPCError('FORBIDDEN', {
          message: 'Link your Brawlhalla account with Steam before uploading replays',
        })
      }

      const files = await Promise.all(
        input.files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
      )

      const outcomes = await uploadReplays(
        { database: runtime.database, objectStore: objectStore(), accounts },
        { accountId: account.id, isOperator, files },
      )

      return { outcomes }
    })

  const match = internalProcedure
    .route({ method: 'GET', path: '/matches/{id}', operationId: 'replays.match', summary: 'Match', tags })
    .input(z.object({ id: matchIdSchema }))
    .output(matchDetailSchema)
    .handler(async ({ context, input }) => {
      await requireSight(context.visitorSessionToken, 'NOT_FOUND')

      const found = await getMatch(runtime.database.sql, input.id)

      if (!found) throw new ORPCError('NOT_FOUND')

      return found
    })

  const playerMatches = internalProcedure
    .route({
      method: 'GET',
      path: '/players/{brawlhallaId}/matches',
      operationId: 'replays.playerMatches',
      summary: 'A player’s matches',
      tags,
    })
    .input(playerMatchesInputSchema)
    .output(playerMatchesSchema)
    .handler(async ({ context, input }) => {
      await requireSight(context.visitorSessionToken, 'NOT_FOUND')

      return listPlayerMatches(runtime.database.sql, input.brawlhallaId, input.cursor)
    })

  const replayFile = internalProcedure
    .route({
      method: 'GET',
      path: '/matches/{id}/replay',
      operationId: 'replays.replayFile',
      summary: 'Replay file',
      tags,
    })
    .input(z.object({ id: matchIdSchema }))
    .output(z.file())
    .handler(async ({ context, input }) => {
      await requireSight(context.visitorSessionToken, 'NOT_FOUND')

      const file = await getReplayFile({ database: runtime.database, objectStore: objectStore() }, input.id)

      if (file === null) throw new ORPCError('NOT_FOUND')

      if (file === 'gone')
        throw new ORPCError('GONE', { status: 410, message: 'This replay’s patch is no longer kept' })

      return new File([new Uint8Array(file.bytes)], file.fileName, { type: 'application/octet-stream' })
    })

  const mine = internalProcedure
    .route({ method: 'GET', path: '/me/replays', operationId: 'replays.mine', summary: 'Your uploads', tags })
    .output(myReplaysSchema)
    .handler(async ({ context }) => {
      const account = await requireAccount(accounts, context.visitorSessionToken)

      await requireSight(context.visitorSessionToken, 'FORBIDDEN')

      return { replays: await listMyReplays(runtime.database.sql, account.id) }
    })

  const access = internalProcedure
    .route({ method: 'GET', path: '/replays/access', operationId: 'replays.access', summary: 'Replay access', tags })
    .output(replayAccessSchema)
    .handler(async ({ context }) => ({ isOpen, canSee: await canSee(context.visitorSessionToken) }))

  return { access, upload, match, playerMatches, replayFile, mine }
}

async function requireAccount(accounts: Accounts, sessionToken: string | undefined) {
  const authentication = await accounts.authenticate(sessionToken ?? null)

  if (authentication.status === 'anonymous') throw new ORPCError('UNAUTHORIZED')

  return authentication.account
}

async function hasVerifiedPlayer(accounts: Accounts, accountId: string): Promise<boolean> {
  const { primaryPlayer } = await accounts.getPrimaryPlayerVerificationState(accountId)

  return primaryPlayer !== null
}

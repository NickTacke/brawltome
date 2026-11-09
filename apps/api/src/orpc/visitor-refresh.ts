import {
  type VisitorRefreshInputContract,
  type VisitorRefreshResponseContract,
  visitorRefreshInputSchema,
  visitorRefreshResponseSchema,
} from '@brawltome/contracts'
import { issueRefreshTrust, verifyRefreshTrust } from '../auth/refresh-trust-cookie'
import { type ClanRefreshContext, requestClanRefresh } from '../clan-refresh-request'
import { type PlayerRefreshContext, requestPlayerRefresh } from '../player-refresh-request'
import { internalApiProcedure, type OrpcContext } from './context'

// what each request brings: who the visitor is and whether they passed the challenge before
type VisitorFields = 'telemetry' | 'clientIp' | 'account' | 'refreshTrust'

export type VisitorRefreshDependencies = Omit<PlayerRefreshContext & ClanRefreshContext, VisitorFields> & {
  refreshTrustSecret: string
  now?: () => number
}

type Visitor = Pick<PlayerRefreshContext, VisitorFields> & { grantedTrust: () => string | null }

// the site has no sign-in yet, so every visitor is anonymous; trust comes from the token the site keeps in a cookie
function createVisitor(context: OrpcContext, input: VisitorRefreshInputContract, secret: string): Visitor {
  const isTrusted = verifyRefreshTrust(input.refreshTrust, secret)
  let grantedTrust: string | null = null

  const refreshTrust = {
    trusted: isTrusted,
    grant: () => {
      if (!isTrusted) grantedTrust = issueRefreshTrust(secret)
    },
  }

  return {
    telemetry: context.telemetry,
    clientIp: context.clientIp,
    account: null,
    refreshTrust,
    grantedTrust: () => grantedTrust,
  }
}

/** Refreshes the site asks for on behalf of a visitor, under the same admission, challenge and budget as tRPC's. */
export function createVisitorRefreshProcedures(dependencies: VisitorRefreshDependencies) {
  const { refreshTrustSecret, now = Date.now } = dependencies

  const player = internalApiProcedure
    .route({
      method: 'POST',
      path: '/players/{id}/refresh',
      operationId: 'refresh.player',
      summary: 'Refresh a stale player for a visitor',
      tags: ['refresh'],
    })
    .input(visitorRefreshInputSchema)
    .output(visitorRefreshResponseSchema)
    .handler(async ({ context, input }): Promise<VisitorRefreshResponseContract> => {
      const visitor = createVisitor(context, input, refreshTrustSecret)
      const request = { id: input.id, turnstileToken: input.turnstileToken }

      const { refresh } = await requestPlayerRefresh({ ...dependencies, ...visitor }, request, undefined, now())

      return { refresh, refreshTrust: visitor.grantedTrust() }
    })

  const clan = internalApiProcedure
    .route({
      method: 'POST',
      path: '/clans/{id}/refresh',
      operationId: 'refresh.clan',
      summary: 'Refresh a stale clan for a visitor',
      tags: ['refresh'],
    })
    .input(visitorRefreshInputSchema)
    .output(visitorRefreshResponseSchema)
    .handler(async ({ context, input }): Promise<VisitorRefreshResponseContract> => {
      const visitor = createVisitor(context, input, refreshTrustSecret)
      const request = { id: input.id, turnstileToken: input.turnstileToken }

      const { refresh } = await requestClanRefresh({ ...dependencies, ...visitor }, request, undefined, now())

      return { refresh, refreshTrust: visitor.grantedTrust() }
    })

  return { player, clan }
}

import { playerViewInputSchema, playerViewResponseSchema } from '@brawltome/contracts'
import { type ProfileViewContext, recordProfileView } from '../profile-view-request'
import { internalApiProcedure } from './context'

export type VisitorViewDependencies = Pick<ProfileViewContext, 'requestAdmission' | 'profileViews'>

/** Page views the site counts on behalf of a visitor, under the same bot check and view budget as tRPC's. */
export function createVisitorViewProcedures(dependencies: VisitorViewDependencies) {
  const player = internalApiProcedure
    .route({
      method: 'POST',
      path: '/players/{id}/views',
      operationId: 'views.player',
      summary: 'Count a view of a player page',
      tags: ['views'],
    })
    .input(playerViewInputSchema)
    .output(playerViewResponseSchema)
    .handler(({ context, input }) => {
      const visitor = { telemetry: context.telemetry, clientIp: context.clientIp, isBot: context.isBot }

      return recordProfileView({ ...dependencies, ...visitor }, input.id)
    })

  return { player }
}

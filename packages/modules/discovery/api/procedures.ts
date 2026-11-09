import { discoverySearchInputSchema, discoverySearchOutputSchema } from '@brawltome/contracts'
import { internalProcedure, type ModuleRuntime } from '@brawltome/foundation'
import { createPostgresDiscovery } from '../postgres'

/** The discovery reads the API serves under discovery, at /rpc/discovery/* and /v1. Only internal callers get them. */
export function createDiscoveryProcedures(runtime: ModuleRuntime) {
  const discovery = createPostgresDiscovery(runtime.database)

  const search = internalProcedure
    .route({
      method: 'GET',
      path: '/search',
      operationId: 'discovery.search',
      summary: 'Search players and guilds by name',
      tags: ['discovery'],
    })
    .input(discoverySearchInputSchema)
    .output(discoverySearchOutputSchema)
    .handler(({ input }) => discovery.search(input.query))

  return { search }
}

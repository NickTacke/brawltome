import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { clanProfileSchema, clanRefreshResponseSchema } from './clan'
import { desktopRankedLookupInputSchema, desktopRankedLookupSchema } from './desktop-ranked'
import {
  desktopLobbyInputSchema,
  desktopLobbySchema,
  desktopUpdateRequiredSchema,
  desktopVersionHeader,
  desktopVersionSchema,
} from './desktop-v1'
import { playerCareerProfileSchema } from './player-career'
import { playerRankedProfileSchema } from './player-ranked'
import { playerRefreshResponseSchema, refreshOutcomeSchema } from './refresh-outcome'
import { z } from './zod'

export function generateContractOpenApi() {
  const registry = new OpenAPIRegistry()
  const desktopRankedResponseSchema = registry.register('DesktopRankedLookup', desktopRankedLookupSchema)
  const desktopLobbyResponseSchema = registry.register('DesktopLobby', desktopLobbySchema)
  const desktopUpdateRequiredResponseSchema = registry.register('DesktopUpdateRequired', desktopUpdateRequiredSchema)
  const desktopLobbyRequestSchema = registry.register('DesktopLobbyInput', desktopLobbyInputSchema)

  registry.register('RefreshOutcome', refreshOutcomeSchema)
  registry.register('PlayerRefreshResponse', playerRefreshResponseSchema)
  registry.register('PlayerCareerProfile', playerCareerProfileSchema)
  registry.register('PlayerRankedProfile', playerRankedProfileSchema)
  registry.register('ClanProfile', clanProfileSchema)
  registry.register('ClanRefreshResponse', clanRefreshResponseSchema)

  registry.registerPath({
    method: 'get',
    path: '/api/overlay/opponent/{brawlhallaId}',
    operationId: 'getDesktopRankedLookup',
    request: {
      params: desktopRankedLookupInputSchema,
    },
    responses: {
      200: {
        description: 'Canonical ranked player snapshot with desktop refresh admission',
        content: {
          'application/json': {
            schema: desktopRankedResponseSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/desktop/v1/lobby',
    operationId: 'postDesktopLobby',
    request: {
      headers: z.object({ [desktopVersionHeader]: desktopVersionSchema }),
      body: { required: true, content: { 'application/json': { schema: desktopLobbyRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Opponent cards for the lobby',
        content: { 'application/json': { schema: desktopLobbyResponseSchema } },
      },
      426: {
        description: 'The desktop app is older than the minimum version this API supports',
        content: { 'application/json': { schema: desktopUpdateRequiredResponseSchema } },
      },
    },
  })

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'BrawlTome Internal Contracts',
      version: '1.0.0',
    },
  })
}

export function serializeContractOpenApi(document: ReturnType<typeof generateContractOpenApi>): string {
  return `${JSON.stringify(sortObject(document), null, 2)}\n`
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)

  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortObject(nested)]),
  )
}

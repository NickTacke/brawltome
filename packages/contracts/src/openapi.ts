import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { contractProofSchema } from './contract-proof'
import { playerRankedProfileSchema } from './player-ranked'
import { playerRefreshResponseSchema, refreshOutcomeSchema } from './refresh-outcome'
import { z } from './zod'

export function generateContractOpenApi() {
  const registry = new OpenAPIRegistry()
  const responseSchema = registry.register('ContractProof', contractProofSchema)
  registry.register('RefreshOutcome', refreshOutcomeSchema)
  registry.register('PlayerRefreshResponse', playerRefreshResponseSchema)
  registry.register('PlayerRankedProfile', playerRankedProfileSchema)

  registry.registerPath({
    method: 'get',
    path: '/internal/contracts/proof',
    operationId: 'getContractProof',
    request: {
      headers: z.object({
        'x-internal-secret': z.string().min(1),
      }),
    },
    responses: {
      200: {
        description: 'Canonical cross-language contract proof',
        content: {
          'application/json': {
            schema: responseSchema,
          },
        },
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

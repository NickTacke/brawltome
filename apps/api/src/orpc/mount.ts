import type { Telemetry } from '@brawltome/telemetry'
import type { AnyContractRouter } from '@orpc/contract'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { ORPCError, onError, type Router } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { Hono } from 'hono'
import { createOrpcContext, type OrpcContext } from './context'

const RPC_PREFIX = '/rpc' as const
// plain HTTP routes of the same router; /v1 is free of the other mounts in serve.ts
const REST_PREFIX = '/v1' as const

const openApiGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
})

// any router whose procedures run on the context this file creates
type MountableRouter = Router<AnyContractRouter, OrpcContext>
type OpenApiDocument = Awaited<ReturnType<typeof openApiGenerator.generate>>

// the router never changes while the process runs, so its document is generated once, on first use
function createOpenApiDocumentReader(router: MountableRouter): () => Promise<OpenApiDocument> {
  let openApiDocument: Promise<OpenApiDocument> | undefined

  return () => {
    openApiDocument ??= openApiGenerator
      .generate(router, {
        info: { title: 'BrawlTome API', version: '1.0.0' },
        // operation paths are relative to where the REST handler is mounted
        servers: [{ url: REST_PREFIX }],
      })
      .catch((error: unknown) => {
        // do not cache a failure: the next request tries again
        openApiDocument = undefined
        throw error
      })

    return openApiDocument
  }
}

function isServerFailure(error: unknown): boolean {
  if (error instanceof ORPCError) return error.status >= 500

  return true
}

function mountHandler(
  routes: Hono,
  prefix: '/rpc' | '/v1',
  handler: RPCHandler<OrpcContext> | OpenAPIHandler<OrpcContext>,
  telemetry: Telemetry,
): void {
  routes.use(`${prefix}/*`, async (c, next) => {
    const { matched, response } = await handler.handle(c.req.raw, {
      prefix,
      context: createOrpcContext(c.req.raw, telemetry),
    })

    if (!matched) return next()

    return c.newResponse(response.body, response)
  })
}

// the serve.ts wrapper already covers admission, telemetry and shutdown; this adds the routes behind it
export function createOrpcRoutes(options: { telemetry: Telemetry; router: MountableRouter }): Hono {
  const { telemetry, router } = options
  const routes = new Hono()
  const readOpenApiDocument = createOpenApiDocumentReader(router)

  const logServerFailure = (error: unknown) => {
    // bad input and the like are the caller's problem, not an incident
    if (!isServerFailure(error)) return

    telemetry.logger.error('orpc.request.failed', error)
  }

  const rpcHandler = new RPCHandler(router, { interceptors: [onError(logServerFailure)] })

  const restHandler = new OpenAPIHandler(router, {
    interceptors: [onError(logServerFailure)],
    // path parameters arrive as text; this turns them into the numbers the contract schemas expect
    plugins: [new SmartCoercionPlugin({ schemaConverters: [new ZodToJsonSchemaConverter()] })],
  })

  mountHandler(routes, RPC_PREFIX, rpcHandler, telemetry)
  mountHandler(routes, REST_PREFIX, restHandler, telemetry)

  routes.get('/openapi.json', async (c) => c.json(await readOpenApiDocument()))

  return routes
}

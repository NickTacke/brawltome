import type { Telemetry } from '@brawltome/telemetry'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ORPCError, onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { Hono } from 'hono'
import { createOrpcContext } from './context'
import { orpcRouter } from './router'

const RPC_PREFIX = '/rpc'

const openApiGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
})

// the router never changes while the process runs, so the document is generated once, on first use
let openApiDocument: ReturnType<typeof openApiGenerator.generate> | undefined

function readOpenApiDocument() {
  openApiDocument ??= openApiGenerator
    .generate(orpcRouter, { info: { title: 'BrawlTome API', version: '1.0.0' } })
    .catch((error: unknown) => {
      // do not cache a failure: the next request tries again
      openApiDocument = undefined
      throw error
    })

  return openApiDocument
}

function isServerFailure(error: unknown): boolean {
  if (error instanceof ORPCError) return error.status >= 500

  return true
}

// the serve.ts wrapper already covers admission, telemetry and shutdown; this adds the routes behind it
export function createOrpcRoutes(options: { telemetry: Telemetry }): Hono {
  const { telemetry } = options
  const routes = new Hono()

  const rpcHandler = new RPCHandler(orpcRouter, {
    interceptors: [
      onError((error) => {
        // bad input and the like are the caller's problem, not an incident
        if (!isServerFailure(error)) return

        telemetry.logger.error('orpc.request.failed', error)
      }),
    ],
  })

  routes.use(`${RPC_PREFIX}/*`, async (c, next) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: RPC_PREFIX,
      context: createOrpcContext(c.req.raw, telemetry),
    })
    if (!matched) return next()

    return c.newResponse(response.body, response)
  })

  routes.get('/openapi.json', async (c) => c.json(await readOpenApiDocument()))

  return routes
}

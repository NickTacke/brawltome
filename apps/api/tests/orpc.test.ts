import { describe, expect, test } from 'bun:test'
import { createTelemetry } from '@brawltome/telemetry'
import { trpcServer } from '@hono/trpc-server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { Hono } from 'hono'
import { readClientIp } from '../src/orpc/context'
import { createOrpcRoutes } from '../src/orpc/mount'
import type { orpcRouter } from '../src/orpc/router'
import { createStatusRouter } from '../src/router/status.router'
import type { Context } from '../src/trpc/context'
import { createDiscordBotProcedure, router } from '../src/trpc/trpc'

const internalSecret = 'orpc-test-internal-secret'
const discordSecret = 'orpc-test-discord-secret'
const secretHeaders = { 'x-internal-secret': internalSecret, 'x-discord-internal-secret': discordSecret }
// status reads only the two secrets, so the rest of the tRPC context is left out
const trpcContext = { internalSecret, discordInternalSecret: discordSecret } as unknown as Context

const trpcStatusRouter = router({
  status: createStatusRouter(createDiscordBotProcedure(internalSecret, discordSecret)),
})

function createApp() {
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
  const app = new Hono()

  app.route('/', createOrpcRoutes({ telemetry }))
  app.use(
    '/trpc/*',
    trpcServer({
      router: trpcStatusRouter,
      createContext: async (_options, context) =>
        ({
          internalSecret: context.req.header('x-internal-secret'),
          discordInternalSecret: context.req.header('x-discord-internal-secret'),
        }) as unknown as Record<string, unknown>,
    }),
  )

  return app
}

function createRpcClient(app: Hono): RouterClient<typeof orpcRouter> {
  const link = new RPCLink({
    url: 'http://api.test/rpc',
    fetch: (request) => app.fetch(request),
  })

  return createORPCClient(link)
}

describe('oRPC next to tRPC', () => {
  test('the rpc status procedure answers with the payload that tRPC status.discordReady also returns', async () => {
    const app = createApp()
    const trpcCaller = trpcStatusRouter.createCaller(trpcContext)
    const trpcStatus = await trpcCaller.status.discordReady()

    const rpcStatus = await createRpcClient(app).status()

    expect(rpcStatus).toEqual(trpcStatus)
    expect(rpcStatus).toEqual({ status: 'ready' })
  })

  test('tRPC still answers beside it', async () => {
    const app = createApp()

    const response = await app.fetch(
      new Request('http://api.test/trpc/status.discordReady', { headers: secretHeaders }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { data: { json: unknown } } }
    expect(body.result.data.json).toEqual({ status: 'ready' })
  })

  test('serves an OpenAPI 3.1 document that describes the status operation', async () => {
    const app = createApp()

    const response = await app.fetch(new Request('http://api.test/openapi.json'))
    const document = (await response.json()) as {
      openapi: string
      info: { title: string; version: string }
      paths: Record<string, Record<string, { operationId?: string; responses: Record<string, unknown> }>>
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(document.openapi).toStartWith('3.1')
    expect(document.info).toEqual({ title: 'BrawlTome API', version: '1.0.0' })
    expect(Object.keys(document.paths)).toEqual(['/status'])
    expect(document.paths['/status'].get.operationId).toBe('status')
    expect(document.paths['/status'].get.responses['200']).toBeDefined()
  })

  test('serves the documented status path over plain HTTP with the same payload as the rpc call', async () => {
    const app = createApp()
    const rpcStatus = await createRpcClient(app).status()

    const response = await app.fetch(new Request('http://api.test/v1/status'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(rpcStatus)
  })

  test('every path in the document resolves under the documented server', async () => {
    const app = createApp()
    const document = (await (await app.fetch(new Request('http://api.test/openapi.json'))).json()) as {
      servers: Array<{ url: string }>
      paths: Record<string, Record<string, unknown>>
    }

    expect(document.servers).toEqual([{ url: '/v1' }])

    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations)) {
        const response = await app.fetch(new Request(`http://api.test${document.servers[0].url}${path}`, { method }))

        expect(response.status, `${method} ${path}`).not.toBe(404)
      }
    }
  })

  test('answers an unknown path under the documented server with 404', async () => {
    const app = createApp()

    const response = await app.fetch(new Request('http://api.test/v1/nothing'))

    expect(response.status).toBe(404)
  })

  test('keeps the descriptions that contracts attach to their schemas', async () => {
    const app = createApp()

    const response = await app.fetch(new Request('http://api.test/openapi.json'))

    expect(await response.text()).toContain('The API is up and accepting requests')
  })

  test('answers an unknown rpc path with 404', async () => {
    const app = createApp()

    const response = await app.fetch(new Request('http://api.test/rpc/nothing', { method: 'POST' }))

    expect(response.status).toBe(404)
  })

  test('reads the client address from the verified header first', () => {
    const headers = new Headers({ 'x-client-ip': '203.0.113.7', 'cf-connecting-ip': '198.51.100.1' })

    expect(readClientIp(headers)).toBe('203.0.113.7')
    expect(readClientIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2')
    expect(readClientIp(new Headers())).toBe('0.0.0.0')
  })
})

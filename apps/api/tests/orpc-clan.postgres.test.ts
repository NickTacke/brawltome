import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { clanModule, createPostgresClans } from '@brawltome/clan'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createTelemetry } from '@brawltome/telemetry'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { Hono } from 'hono'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter, type OrpcRouter } from '../src/orpc/router'
import { createClanRouter } from '../src/router/clan.router'
import type { Context } from '../src/trpc/context'
import { createDiscordBotProcedure, createInternalProcedure } from '../src/trpc/trpc'
import {
  type ClanScenario,
  completeClan,
  identityOnlyClan,
  legacyClan,
  profileOnlyClan,
  seedClan,
  sparseMembersClan,
  unpublishedProfileClan,
} from './fixtures/clans'

const secret = 'orpc-clan-test-secret'
const discordSecret = 'discord-orpc-clan-test-secret'
const unknownClanId = 999_999
const internalHeaders = { 'x-internal-secret': secret }
const wrongSecretHeaders = { 'x-internal-secret': `${secret}-wrong` }

const refusedCallers = [
  { caller: 'no secret', headers: {} },
  { caller: 'a wrong secret', headers: wrongSecretHeaders },
]

const storedScenarios = [completeClan, legacyClan, sparseMembersClan, profileOnlyClan]
const nullScenarios = [identityOnlyClan, unpublishedProfileClan]
const scenarios: ClanScenario[] = [...storedScenarios, ...nullScenarios]

// a member of a stored clan, a player in no clan, and a member of a clan that has no profile
const playerIds = [30, 8_888_888, 61]

let database: TestDatabase
let app: Hono

beforeAll(async () => {
  database = await createTestDatabase({ label: 'orpc_clan', modules: [clanModule] })

  for (const scenario of scenarios) await seedClan(database, scenario.clan)

  const router = createOrpcRouter([clanModule], { database, env: {} })
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })

  app = new Hono()
  app.route('/', createOrpcRoutes({ telemetry, router, internalSecret: secret }))
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

function createTrpcCaller() {
  const context = {
    internalSecret: secret,
    discordInternalSecret: discordSecret,
    clanRepo: createPostgresClans(database),
  } as unknown as Context

  const router = createClanRouter(createInternalProcedure(secret), createDiscordBotProcedure(secret, discordSecret))

  return router.createCaller(context)
}

// the clan reads are internal like on tRPC, so callers send the secret unless a test says otherwise
function createRpcClient(headers: Record<string, string> = internalHeaders): RouterClient<OrpcRouter> {
  const link = new RPCLink({
    url: 'http://api.test/rpc',
    headers,
    fetch: async (request) => app.fetch(request),
  })

  return createORPCClient(link)
}

async function fetchJson(
  path: string,
  headers: Record<string, string> = internalHeaders,
): Promise<{ status: number; body: unknown }> {
  const response = await app.fetch(new Request(`http://api.test${path}`, { headers }))

  return { status: response.status, body: await response.json() }
}

describe('clan.byId over oRPC', () => {
  test('returns the payload tRPC clan.byId returns for every stored clan', async () => {
    const trpc = createTrpcCaller()
    const client = createRpcClient()

    for (const scenario of storedScenarios) {
      const trpcProfile = await trpc.byId({ id: scenario.clan.clanId })
      const rpcProfile = await client.clan.byId({ id: scenario.clan.clanId })

      expect(rpcProfile).not.toBeNull()
      expect(rpcProfile).toEqual(trpcProfile)
      expect(rpcProfile).toEqual(scenario.expected)
    }
  })

  test('returns null where tRPC clan.byId returns null', async () => {
    const trpc = createTrpcCaller()
    const client = createRpcClient()

    for (const clanId of [...nullScenarios.map(({ clan }) => clan.clanId), unknownClanId]) {
      expect(await trpc.byId({ id: clanId })).toBeNull()
      expect(await client.clan.byId({ id: clanId })).toBeNull()
    }
  })

  test('serves the same payload at GET /v1/clans/{id}', async () => {
    const trpc = createTrpcCaller()

    for (const clanId of [...scenarios.map(({ clan }) => clan.clanId), unknownClanId]) {
      const trpcProfile = await trpc.byId({ id: clanId })

      expect(await fetchJson(`/v1/clans/${clanId}`)).toEqual({ status: 200, body: trpcProfile })
    }
  })

  test('rejects an id the contract does not accept', async () => {
    const client = createRpcClient()

    // @ts-expect-error the typed client knows the input is a clan id
    await expect(client.clan.byId({ id: 'one' })).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })

    expect((await fetchJson('/v1/clans/0')).status).toBe(400)
  })
})

describe('clan.membershipByPlayerId over oRPC', () => {
  test('returns the payload tRPC clan.membershipByPlayerId returns, null included', async () => {
    const trpc = createTrpcCaller()
    const client = createRpcClient()

    for (const playerId of playerIds) {
      const trpcMembership = await trpc.membershipByPlayerId({ id: playerId })
      const rpcMembership = await client.clan.membershipByPlayerId({ id: playerId })

      expect(rpcMembership).toEqual(trpcMembership)
    }

    expect(await client.clan.membershipByPlayerId({ id: 30 })).toEqual({ clanId: 101, clanName: 'Complete Clan' })
  })

  test('serves the same payload at GET /v1/players/{id}/clan', async () => {
    const trpc = createTrpcCaller()

    for (const playerId of playerIds) {
      const trpcMembership = await trpc.membershipByPlayerId({ id: playerId })

      expect(await fetchJson(`/v1/players/${playerId}/clan`)).toEqual({ status: 200, body: trpcMembership })
    }
  })
})

describe('the internal secret on the oRPC clan reads', () => {
  for (const { caller, headers } of refusedCallers) {
    test(`refuses ${caller} over /rpc with FORBIDDEN`, async () => {
      const client = createRpcClient(headers)
      const forbidden = { code: 'FORBIDDEN', status: 403 }

      await expect(client.clan.byId({ id: completeClan.clan.clanId })).rejects.toMatchObject(forbidden)
      await expect(client.clan.membershipByPlayerId({ id: 30 })).rejects.toMatchObject(forbidden)
    })

    test(`refuses ${caller} over /v1 with 403`, async () => {
      const clan = await fetchJson(`/v1/clans/${completeClan.clan.clanId}`, headers)
      const membership = await fetchJson('/v1/players/30/clan', headers)

      expect(clan).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
      expect(membership).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    })
  }

  test('still serves /v1/status without a secret', async () => {
    expect(await fetchJson('/v1/status', {})).toEqual({ status: 200, body: { status: 'ready' } })
  })
})

describe('the OpenAPI document with the clan module loaded', () => {
  test('lists both clan reads next to status', async () => {
    const { body } = await fetchJson('/openapi.json', {})
    const document = body as { paths: Record<string, Record<string, { operationId?: string }>> }

    expect(Object.keys(document.paths).sort()).toEqual(['/clans/{id}', '/players/{id}/clan', '/status'])
    expect(document.paths['/clans/{id}'].get.operationId).toBe('clan.byId')
    expect(document.paths['/players/{id}/clan'].get.operationId).toBe('clan.membershipByPlayerId')
  })

  test('declares the internal secret on the clan reads and none on status', async () => {
    const { body } = await fetchJson('/openapi.json', {})

    const document = body as {
      components: { securitySchemes: Record<string, unknown> }
      paths: Record<string, Record<string, { security?: unknown }>>
    }

    expect(document.components.securitySchemes).toEqual({
      internalSecret: { type: 'apiKey', in: 'header', name: 'x-internal-secret' },
    })

    expect(document.paths['/clans/{id}'].get.security).toEqual([{ internalSecret: [] }])
    expect(document.paths['/players/{id}/clan'].get.security).toEqual([{ internalSecret: [] }])
    expect(document.paths['/status'].get.security).toBeUndefined()
  })
})

import { describe, expect, test } from 'bun:test'
import { accountsModule } from '@brawltome/accounts'
import { clanModule } from '@brawltome/clan'
import { type BrawltomeModule, checkModuleList, type Database, type ModuleRuntime } from '@brawltome/foundation'
import { queueModule } from '@brawltome/queue'
import { replayAnalysisModule } from '@brawltome/replay-analysis'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { apiModules } from '../src/modules'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter, type OrpcRouter } from '../src/orpc/router'
import { workerModules } from '../src/worker-modules'

function without(modules: readonly BrawltomeModule[], left: BrawltomeModule): BrawltomeModule[] {
  return modules.filter((module) => module !== left)
}

// building the procedures only hands the database to them; nothing here calls a handler that would read it
const runtime: ModuleRuntime = { database: {} as Database }

describe('module lists', () => {
  test('the API loads every module its modules depend on', () => {
    expect(() => checkModuleList(apiModules)).not.toThrow()
  })

  test('the operations worker loads every module its modules depend on', () => {
    expect(() => checkModuleList(workerModules)).not.toThrow()
  })

  test('leaving out a module nothing depends on still passes', () => {
    expect(() => checkModuleList(without(apiModules, replayAnalysisModule))).not.toThrow()
  })

  test('leaving out a module others depend on names a dependant', () => {
    expect(() => checkModuleList(without(apiModules, queueModule))).toThrow(
      'module accounts depends on queue, which is not loaded',
    )

    expect(() => checkModuleList(without(apiModules, accountsModule))).toThrow(
      'module replay-analysis depends on accounts, which is not loaded',
    )
  })
})

describe('oRPC router built from a module list', () => {
  test('puts the procedures of each module under its name', () => {
    const router = createOrpcRouter(apiModules, runtime)

    expect(Object.keys(router).sort()).toEqual(['clan', 'status'])
    expect(Object.keys(router.clan).sort()).toEqual(['byId', 'membershipByPlayerId'])
  })

  test('types the router with exactly the served keys', () => {
    const servedKeys: (keyof OrpcRouter)[] = ['status', 'clan']

    // @ts-expect-error a module name that widened to string would let any key through
    const unservedKey: keyof OrpcRouter = 'nothing'

    expect(servedKeys).not.toContain(unservedKey)
  })

  test('has no clan key without the clan module, and still answers /v1/status', async () => {
    const router = createOrpcRouter(without(apiModules, clanModule), runtime)
    const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
    const app = new Hono()

    app.route('/', createOrpcRoutes({ telemetry, internalSecret: undefined, router }))

    const response = await app.fetch(new Request('http://api.test/v1/status'))

    expect(router).not.toHaveProperty('clan')
    expect(Object.keys(router)).toEqual(['status'])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })
})

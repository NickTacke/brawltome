import { describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { createPlayerViewRouter } from '../src/router/player.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'player-view-router-test-secret-32-characters'

function caller(overrides: Partial<Context>) {
  const telemetry = createTelemetry({ service: 'api', sink: createMemorySink(), capacity: 10, drainIntervalMs: 0 })
  const context = { internalSecret: secret, isBot: false, telemetry, ...overrides } as Context
  return createPlayerViewRouter(createInternalProcedure(secret)).createCaller(context)
}

describe('player view router', () => {
  test('records views from people, skips bots, and never fails the visitor', async () => {
    const recorded: number[] = []
    const profileViews = {
      recordView: async (brawlhallaId: number) => {
        recorded.push(brawlhallaId)
      },
    }
    expect(await caller({ profileViews }).recordView({ id: 42 })).toEqual({ recorded: true })
    expect(await caller({ profileViews, isBot: true }).recordView({ id: 43 })).toEqual({ recorded: false })
    expect(recorded).toEqual([42])

    const failing = {
      recordView: async () => {
        throw new Error('database unavailable')
      },
    }
    expect(await caller({ profileViews: failing }).recordView({ id: 44 })).toEqual({ recorded: false })
    await expect(caller({ profileViews }).recordView({ id: 0 })).rejects.toThrow()
  })
})

import { describe, expect, test } from 'bun:test'
import type { ActorAdmission, AdmissionActor } from '@brawltome/request-admission'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { createPlayerViewRouter } from '../src/router/player.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'player-view-router-test-secret-32-characters'

function admission(admitted = true, actors: AdmissionActor[] = []) {
  return {
    admitActorOnce: async (actor: AdmissionActor) => {
      actors.push(actor)
      return admitted ? { outcome: 'admitted' as const } : { outcome: 'rate-limited' as const, retryAfterSeconds: 60 }
    },
  } as unknown as ActorAdmission
}

function caller(overrides: Partial<Context>) {
  const telemetry = createTelemetry({ service: 'api', sink: createMemorySink(), capacity: 10, drainIntervalMs: 0 })
  const context = {
    internalSecret: secret,
    isBot: false,
    clientIp: '203.0.113.5',
    requestAdmission: admission(),
    telemetry,
    ...overrides,
  } as Context
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

  test('charges each view to the visitor and silently skips views over their limit', async () => {
    const recorded: number[] = []
    const actors: AdmissionActor[] = []
    const profileViews = {
      recordView: async (brawlhallaId: number) => {
        recorded.push(brawlhallaId)
      },
    }
    expect(await caller({ profileViews, requestAdmission: admission(true, actors) }).recordView({ id: 7 })).toEqual({
      recorded: true,
    })
    expect(await caller({ profileViews, requestAdmission: admission(false) }).recordView({ id: 8 })).toEqual({
      recorded: false,
    })
    const unavailable = {
      admitActorOnce: async () => {
        throw new Error('database unavailable')
      },
    } as unknown as ActorAdmission
    expect(await caller({ profileViews, requestAdmission: unavailable }).recordView({ id: 9 })).toEqual({
      recorded: false,
    })
    expect(actors).toEqual([{ kind: 'profile-view', ip: '203.0.113.5' }])
    expect(recorded).toEqual([7])
  })
})

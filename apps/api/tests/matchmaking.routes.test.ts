import { describe, expect, test } from 'bun:test'
import { createMatchmakingRoutes } from '../src/routes/matchmaking.routes'

describe('matchmaking ingest route', () => {
  test('returns shared PostgreSQL admission backoff without creating a durable reservation', async () => {
    const metrics: Array<{ name: string; labels: Record<string, string> }> = []
    const app = createMatchmakingRoutes({
      matchRepo: {} as never,
      r2: {} as never,
      requestAdmission: {
        admitActorOnce: async (actor: unknown) => {
          expect(actor).toEqual({ kind: 'matchmaking-ingest', accountId: 'account-42' })
          return { outcome: 'rate-limited' as const, retryAfterSeconds: 37 }
        },
      } as never,
      telemetry: {
        metrics: {
          add: (name: string, _value: number, labels: Record<string, string>) => metrics.push({ name, labels }),
        },
      } as never,
      accounts: {
        authenticate: async (token: string | null) => {
          expect(token).toBe('session-token')
          return { status: 'signedIn' as const, account: { id: 'account-42' } }
        },
      } as never,
      enabled: true,
    })

    const response = await app.request('/ingest', {
      method: 'POST',
      headers: { cookie: 'brawltome_session=session-token' },
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('37')
    expect(await response.json()).toEqual({ code: 'rate_limited' })
    expect(metrics).toEqual([{ name: 'matchmaking_ingest_total', labels: { outcome: 'rate_limited' } }])
  })

  test('authenticates before consuming admission', async () => {
    let admissionCalls = 0
    const app = createMatchmakingRoutes({
      matchRepo: {} as never,
      r2: {} as never,
      requestAdmission: {
        admitActorOnce: async () => {
          admissionCalls++
          return { outcome: 'admitted' as const }
        },
      } as never,
      telemetry: {} as never,
      accounts: { authenticate: async () => ({ status: 'anonymous' as const }) } as never,
      enabled: true,
    })

    const response = await app.request('/ingest', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(admissionCalls).toBe(0)
  })
})

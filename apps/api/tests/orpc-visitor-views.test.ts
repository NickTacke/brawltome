import { describe, expect, test } from 'bun:test'
import type { Database } from '@brawltome/foundation'
import type { ActorAdmissionResult, AdmissionActor } from '@brawltome/request-admission'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { requestWithVerifiedClientIp } from '../src/client-ip'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'
import { createVisitorViewProcedures } from '../src/orpc/visitor-views'

const internalSecret = 'visitor-views-test-internal-secret-0123456'
const siteAddress = '172.18.0.9'
const visitorAddress = '198.51.100.20'
const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15'

const siteHeaders = {
  'x-internal-secret': internalSecret,
  'x-visitor-real-ip': visitorAddress,
  'x-visitor-user-agent': browser,
}

type HarnessOptions = { admission?: ActorAdmissionResult; isStoreDown?: boolean }

function createHarness({ admission, isStoreDown }: HarnessOptions = {}) {
  const admitted: AdmissionActor[] = []
  const recorded: number[] = []

  const requestAdmission = {
    admitActorOnce: async (actor: AdmissionActor) => {
      admitted.push(actor)

      return admission ?? { outcome: 'admitted' }
    },
  }

  const profileViews = {
    recordView: async (brawlhallaId: number) => {
      if (isStoreDown) throw new Error('database unavailable')

      recorded.push(brawlhallaId)
    },
  }

  const views = createVisitorViewProcedures({ requestAdmission, profileViews } as never)
  const router = createOrpcRouter([], { database: {} as Database }, { views })
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
  const app = new Hono()

  app.route('/', createOrpcRoutes({ telemetry, internalSecret, router }))

  // goes through the same address check serve.ts runs before any route
  async function view(headers: Record<string, string> = siteHeaders) {
    const request = new Request('http://api.test/v1/players/7/views', { method: 'POST', headers })
    const response = await app.fetch(requestWithVerifiedClientIp(request, siteAddress, internalSecret))

    return { status: response.status, body: await response.json() }
  }

  return { view, admitted, recorded }
}

describe('visitor view procedure', () => {
  test('refuses callers without the internal secret', async () => {
    const harness = createHarness()

    expect((await harness.view({ 'x-visitor-real-ip': visitorAddress })).status).toBe(403)
    expect(harness.recorded).toEqual([])
  })

  test('counts a view and charges it to the visitor', async () => {
    const harness = createHarness()

    expect(await harness.view()).toEqual({ status: 200, body: { recorded: true } })
    expect(harness.admitted).toEqual([{ kind: 'profile-view', ip: visitorAddress }])
    expect(harness.recorded).toEqual([7])
  })

  test('skips a crawler named by the visitor user agent', async () => {
    const harness = createHarness()
    const crawler = { ...siteHeaders, 'x-visitor-user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }

    expect((await harness.view(crawler)).body).toEqual({ recorded: false })
    expect(harness.admitted).toEqual([])
  })

  test('skips a view over the visitor budget', async () => {
    const harness = createHarness({ admission: { outcome: 'rate-limited', retryAfterSeconds: 60 } })

    expect((await harness.view()).body).toEqual({ recorded: false })
    expect(harness.recorded).toEqual([])
  })

  test('answers without counting when the store fails', async () => {
    const harness = createHarness({ isStoreDown: true })

    expect(await harness.view()).toEqual({ status: 200, body: { recorded: false } })
  })
})

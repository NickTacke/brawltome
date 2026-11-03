import { describe, expect, test } from 'bun:test'
import { triggerDeploy } from '../trigger-deploy'

type Deployment = { deploymentId: string; status: string; createdAt: string }
type Call = { url: string; init?: RequestInit }

const triggeredAtMs = Date.parse('2026-11-03T12:00:00.000Z')
const afterTrigger = '2026-11-03T12:00:05.000Z'
const beforeTrigger = '2026-11-03T11:00:00.000Z'

// the fake clock moves forward only when the code sleeps, like real time during polling
function createFakeDokploy(options: { deployStatus?: number; pollResults: Deployment[][] }) {
  const calls: Call[] = []
  let pollCount = 0
  let nowMs = triggeredAtMs

  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('compose.deploy')) return new Response('{}', { status: options.deployStatus ?? 200 })

    const index = Math.min(pollCount, options.pollResults.length - 1)
    pollCount += 1

    return Response.json({ deployments: options.pollResults[index] })
  }) as typeof fetch

  return {
    calls,
    fetch: fetchFake,
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms
    },
  }
}

function deployOptions(fake: ReturnType<typeof createFakeDokploy>, overrides = {}) {
  return {
    dokployUrl: 'https://dokploy.example',
    token: 'secret-token',
    composeId: 'compose-1',
    fetch: fake.fetch,
    now: fake.now,
    sleep: fake.sleep,
    ...overrides,
  }
}

describe('triggerDeploy', () => {
  test('resolves when the new deployment is done', async () => {
    const fake = createFakeDokploy({
      pollResults: [
        [{ deploymentId: 'new', status: 'running', createdAt: afterTrigger }],
        [{ deploymentId: 'new', status: 'done', createdAt: afterTrigger }],
      ],
    })

    expect(await triggerDeploy(deployOptions(fake))).toBe('done')
  })

  test('ignores deployments created before the trigger', async () => {
    const fake = createFakeDokploy({
      pollResults: [
        [{ deploymentId: 'old', status: 'done', createdAt: beforeTrigger }],
        [
          { deploymentId: 'old', status: 'done', createdAt: beforeTrigger },
          { deploymentId: 'new', status: 'running', createdAt: afterTrigger },
        ],
        [
          { deploymentId: 'new', status: 'done', createdAt: afterTrigger },
          { deploymentId: 'old', status: 'done', createdAt: beforeTrigger },
        ],
      ],
    })

    await triggerDeploy(deployOptions(fake))

    const pollCount = fake.calls.filter((call) => call.url.includes('compose.one')).length
    expect(pollCount).toBe(3)
  })

  test('throws with the deployment id when it fails', async () => {
    const fake = createFakeDokploy({
      pollResults: [[{ deploymentId: 'broken', status: 'error', createdAt: afterTrigger }]],
    })

    await expect(triggerDeploy(deployOptions(fake))).rejects.toThrow(
      'dokploy deployment broken for compose compose-1 failed',
    )
  })

  test('gives up after the timeout', async () => {
    const fake = createFakeDokploy({
      pollResults: [[{ deploymentId: 'stuck', status: 'running', createdAt: afterTrigger }]],
    })

    await expect(triggerDeploy(deployOptions(fake, { timeoutMs: 60_000 }))).rejects.toThrow(
      'dokploy deployment for compose compose-1 did not finish within 1 min',
    )
  })

  test('throws when Dokploy rejects the deploy request', async () => {
    const fake = createFakeDokploy({ deployStatus: 401, pollResults: [[]] })

    await expect(triggerDeploy(deployOptions(fake))).rejects.toThrow('401')
  })

  test('sends the token as x-api-key and never in the URL', async () => {
    const fake = createFakeDokploy({
      pollResults: [[{ deploymentId: 'new', status: 'done', createdAt: afterTrigger }]],
    })

    await triggerDeploy(deployOptions(fake))

    expect(fake.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of fake.calls) {
      expect(new Headers(call.init?.headers).get('x-api-key')).toBe('secret-token')
      expect(call.url).not.toContain('secret-token')
    }
  })
})

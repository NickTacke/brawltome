import { describe, expect, test } from 'bun:test'
import { triggerDeploy } from '../trigger-deploy'

type Deployment = { deploymentId: string; status: string; createdAt: string }
type Call = { url: string; init?: RequestInit }

const startMs = Date.parse('2026-11-03T12:00:00.000Z')
// createdAt is deliberately skewed: matching must not depend on it
const skewedCreatedAt = '2026-11-03T10:00:00.000Z'
const oldDeployment: Deployment = { deploymentId: 'old', status: 'done', createdAt: skewedCreatedAt }

function deployment(deploymentId: string, status: string): Deployment {
  return { deploymentId, status, createdAt: skewedCreatedAt }
}

// the first compose.one result is the read before the trigger; the fake clock moves only when the code sleeps
function createFakeDokploy(options: { deployStatus?: number; hang?: boolean; composeResults: Deployment[][] }) {
  const calls: Call[] = []
  let composeReadCount = 0
  let nowMs = startMs

  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (options.hang)
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      )
    if (url.includes('compose.deploy')) return new Response('{}', { status: options.deployStatus ?? 200 })

    const index = Math.min(composeReadCount, options.composeResults.length - 1)
    composeReadCount += 1

    return Response.json({ deployments: options.composeResults[index] })
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
      composeResults: [[], [deployment('new', 'running')], [deployment('new', 'done')]],
    })

    expect(await triggerDeploy(deployOptions(fake))).toBe('done')
  })

  test('ignores deployments that existed before the trigger', async () => {
    const fake = createFakeDokploy({
      composeResults: [
        [oldDeployment],
        [oldDeployment],
        [oldDeployment, deployment('new', 'running')],
        [deployment('new', 'done'), oldDeployment],
      ],
    })

    await triggerDeploy(deployOptions(fake))

    const composeReadCount = fake.calls.filter((call) => call.url.includes('compose.one')).length
    expect(composeReadCount).toBe(4)
  })

  test('throws with the deployment id when it fails', async () => {
    const fake = createFakeDokploy({ composeResults: [[], [deployment('broken', 'error')]] })

    await expect(triggerDeploy(deployOptions(fake))).rejects.toThrow(
      'dokploy deployment broken for compose compose-1 failed',
    )
  })

  test('gives up after the timeout', async () => {
    const fake = createFakeDokploy({ composeResults: [[], [deployment('stuck', 'running')]] })

    await expect(triggerDeploy(deployOptions(fake, { timeoutMs: 60_000 }))).rejects.toThrow(
      'dokploy deployment for compose compose-1 did not finish within 1 min',
    )
  })

  test('gives up when a request never answers', async () => {
    const fake = createFakeDokploy({ hang: true, composeResults: [[]] })

    await expect(triggerDeploy(deployOptions(fake, { requestTimeoutMs: 20 }))).rejects.toThrow(
      'dokploy request for compose compose-1 timed out',
    )
  })

  test('throws when Dokploy rejects the deploy request', async () => {
    const fake = createFakeDokploy({ deployStatus: 401, composeResults: [[]] })

    await expect(triggerDeploy(deployOptions(fake))).rejects.toThrow('401')
  })

  test('sends the token as x-api-key and never in the URL', async () => {
    const fake = createFakeDokploy({ composeResults: [[], [deployment('new', 'done')]] })

    await triggerDeploy(deployOptions(fake))

    expect(fake.calls.length).toBeGreaterThanOrEqual(3)
    for (const call of fake.calls) {
      expect(new Headers(call.init?.headers).get('x-api-key')).toBe('secret-token')
      expect(call.url).not.toContain('secret-token')
    }
  })
})

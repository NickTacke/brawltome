#!/usr/bin/env bun

const defaultTimeoutMs = 20 * 60_000
const defaultPollIntervalMs = 10_000

type Deployment = { deploymentId: string; status: string; createdAt: string }

export type TriggerDeployOptions = {
  dokployUrl: string
  token: string
  composeId: string
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  pollIntervalMs?: number
}

/** Starts a Dokploy compose deployment and waits until it is done, failed, or out of time. */
export async function triggerDeploy(options: TriggerDeployOptions): Promise<'done'> {
  const fetchFromNetwork = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs
  const headers = { 'x-api-key': options.token, 'content-type': 'application/json' }
  const baseUrl = options.dokployUrl.replace(/\/+$/, '')

  const triggeredAtMs = now()
  const deadlineMs = triggeredAtMs + timeoutMs

  const deployResponse = await fetchFromNetwork(`${baseUrl}/api/compose.deploy`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ composeId: options.composeId }),
  })
  if (!deployResponse.ok)
    throw new Error(
      `dokploy rejected the deploy request for compose ${options.composeId}: HTTP ${deployResponse.status}`,
    )

  const composeUrl = `${baseUrl}/api/compose.one?composeId=${encodeURIComponent(options.composeId)}`

  while (true) {
    const composeResponse = await fetchFromNetwork(composeUrl, { headers })
    if (!composeResponse.ok)
      throw new Error(`dokploy status request for compose ${options.composeId} failed: HTTP ${composeResponse.status}`)

    const compose = (await composeResponse.json()) as { deployments?: Deployment[] }
    const newDeployments = (compose.deployments ?? []).filter(
      (deployment) => Date.parse(deployment.createdAt) >= triggeredAtMs,
    )

    const failed = newDeployments.find((deployment) => deployment.status === 'error')
    if (failed) throw new Error(`dokploy deployment ${failed.deploymentId} for compose ${options.composeId} failed`)

    if (newDeployments.some((deployment) => deployment.status === 'done')) return 'done'

    if (now() >= deadlineMs) {
      const timeoutMinutes = Math.round(timeoutMs / 60_000)
      throw new Error(`dokploy deployment for compose ${options.composeId} did not finish within ${timeoutMinutes} min`)
    }

    await sleep(pollIntervalMs)
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)

  return value
}

if (import.meta.main) {
  try {
    await triggerDeploy({
      dokployUrl: requireEnvironment('DOKPLOY_URL'),
      token: requireEnvironment('DOKPLOY_TOKEN'),
      composeId: requireEnvironment('DOKPLOY_COMPOSE_ID'),
    })
    console.log('Dokploy deployment finished.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

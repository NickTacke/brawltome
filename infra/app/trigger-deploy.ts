#!/usr/bin/env bun

const defaultTimeoutMs = 20 * 60_000
const defaultPollIntervalMs = 10_000
const defaultRequestTimeoutMs = 30_000

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
  requestTimeoutMs?: number
  // the commit this run built; with readBranchHead, a run whose commit is no longer the head skips its deploy
  releaseSha?: string
  readBranchHead?: () => Promise<string>
}

/**
 * Starts a Dokploy compose deployment and waits until it is done, failed, or out of time. Skips it when a newer
 * commit is already on the branch: Dokploy deploys the branch head, whose images that commit's own run has not
 * promoted yet, and that run deploys it next.
 */
export async function triggerDeploy(options: TriggerDeployOptions): Promise<'done' | 'superseded'> {
  if (await isSuperseded(options)) return 'superseded'

  const fetchFromNetwork = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs
  const requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs
  const headers = { 'x-api-key': options.token, 'content-type': 'application/json' }
  const baseUrl = options.dokployUrl.replace(/\/+$/, '')
  const composeUrl = `${baseUrl}/api/compose.one?composeId=${encodeURIComponent(options.composeId)}`

  // a hung connection must not outlive the overall timeout, so every request gets its own deadline
  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFromNetwork(url, { ...init, headers, signal: AbortSignal.timeout(requestTimeoutMs) })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError')
        throw new Error(`dokploy request for compose ${options.composeId} timed out after ${requestTimeoutMs / 1000} s`)

      throw error
    }
  }

  async function readDeployments(): Promise<Deployment[]> {
    const response = await request(composeUrl, {})

    if (!response.ok)
      throw new Error(`dokploy status request for compose ${options.composeId} failed: HTTP ${response.status}`)

    const compose = (await response.json()) as { deployments?: Deployment[] }

    return compose.deployments ?? []
  }

  // the runner and Dokploy clocks may differ, so new deployments are told apart by id, not by time
  const existingDeploymentIds = new Set((await readDeployments()).map((deployment) => deployment.deploymentId))
  const deadlineMs = now() + timeoutMs

  const deployResponse = await request(`${baseUrl}/api/compose.deploy`, {
    method: 'POST',
    body: JSON.stringify({ composeId: options.composeId }),
  })

  if (!deployResponse.ok)
    throw new Error(
      `dokploy rejected the deploy request for compose ${options.composeId}: HTTP ${deployResponse.status}`,
    )

  while (true) {
    const deployments = await readDeployments()
    const newDeployments = deployments.filter((deployment) => !existingDeploymentIds.has(deployment.deploymentId))

    const outcome = readOutcome(newDeployments)

    if (outcome?.status === 'error')
      throw new Error(`dokploy deployment ${outcome.deploymentId} for compose ${options.composeId} failed`)

    if (outcome) return 'done'

    if (now() >= deadlineMs) {
      const timeoutMinutes = Math.round(timeoutMs / 60_000)

      throw new Error(`dokploy deployment for compose ${options.composeId} did not finish within ${timeoutMinutes} min`)
    }

    await sleep(pollIntervalMs)
  }
}

// compose.deploy returns no deployment id, so a manual deployment started in the same moment is indistinguishable
// from ours: wait for all of them and judge by the newest one, which is the state production ends up in
function readOutcome(newDeployments: Deployment[]): Deployment | undefined {
  if (newDeployments.length === 0) return undefined

  if (newDeployments.some((deployment) => deployment.status !== 'done' && deployment.status !== 'error'))
    return undefined

  return newDeployments.reduce((newest, deployment) =>
    Date.parse(deployment.createdAt) > Date.parse(newest.createdAt) ? deployment : newest,
  )
}

async function isSuperseded(options: TriggerDeployOptions): Promise<boolean> {
  if (!options.releaseSha || !options.readBranchHead) return false

  const branchHead = await options.readBranchHead()

  return branchHead !== options.releaseSha
}

type CommandResult = { exitCode: number; stdout: string }
type RunCommand = (command: string[]) => Promise<CommandResult>

const lsRemoteTimeoutMs = 30_000

async function runCommand(command: string[]): Promise<CommandResult> {
  const child = Bun.spawn(command, { timeout: lsRemoteTimeoutMs })
  const stdout = await new Response(child.stdout).text()

  return { exitCode: await child.exited, stdout }
}

/** Reads a branch's head commit from the remote, not the checkout, which is pinned to the commit this run built. */
export function readRemoteBranchHead(repository: string, branch: string, run: RunCommand = runCommand) {
  return async (): Promise<string> => {
    const result = await run(['git', 'ls-remote', `https://github.com/${repository}.git`, `refs/heads/${branch}`])

    if (result.exitCode !== 0)
      throw new Error(`read the head of ${repository} ${branch}: git ls-remote exited ${result.exitCode}`)

    const sha = result.stdout.split(/\s/)[0]

    if (!sha) throw new Error(`read the head of ${repository} ${branch}: no such branch`)

    return sha
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]

  if (!value) throw new Error(`${name} is not set`)

  return value
}

if (import.meta.main) {
  try {
    const outcome = await triggerDeploy({
      dokployUrl: requireEnvironment('DOKPLOY_URL'),
      token: requireEnvironment('DOKPLOY_TOKEN'),
      composeId: requireEnvironment('DOKPLOY_COMPOSE_ID'),
      releaseSha: requireEnvironment('GITHUB_SHA'),
      readBranchHead: readRemoteBranchHead(
        requireEnvironment('GITHUB_REPOSITORY'),
        requireEnvironment('GITHUB_REF_NAME'),
      ),
    })

    if (outcome === 'superseded') console.log('A newer commit is on the branch; its own run deploys it.')
    else console.log('Dokploy deployment finished.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

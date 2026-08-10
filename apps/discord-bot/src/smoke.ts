import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { REST, Routes } from 'discord.js'

export type DiscordSmokeEnvironment = 'staging-guild' | 'production'
type CommandScope = { kind: 'guild'; guildId: string } | { kind: 'global' }
type RegisteredCommand = { name: string }

type SmokeArtifact = {
  schema: 1
  environment: DiscordSmokeEnvironment
  status: 'preflight-passed'
  checkedAt: string
  liveDeploymentClaim: false
  preflightChecks: Array<{ name: string; status: 'passed' }>
  interactionChecks: Array<{
    command: '/player' | '/clan' | '/status'
    status: 'pending'
    requiredEvidence: string
  }>
}

interface SmokeDependencies {
  environment?: Record<string, string | undefined>
  listCommands?: (input: {
    token: string
    clientId: string
    scope: CommandScope
  }) => Promise<readonly RegisteredCommand[]>
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: () => Date
  writeArtifact?: (path: string, contents: string) => Promise<void>
}

const requiredCommands = ['player', 'clan', 'status'] as const

function requireConfiguration(
  environment: Record<string, string | undefined>,
  mode: DiscordSmokeEnvironment,
): { token: string; clientId: string; apiUrl: string; scope: CommandScope; artifactPath: string } {
  const missing = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'API_URL'].filter((name) => !environment[name])
  if (mode === 'staging-guild' && !environment.DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID')
  if (missing.length > 0) throw new Error(`Missing required smoke configuration: ${missing.join(', ')}`)

  return {
    token: environment.DISCORD_TOKEN as string,
    clientId: environment.DISCORD_CLIENT_ID as string,
    apiUrl: (environment.API_URL as string).replace(/\/$/, ''),
    scope:
      mode === 'staging-guild'
        ? { kind: 'guild', guildId: environment.DISCORD_GUILD_ID as string }
        : { kind: 'global' },
    artifactPath:
      environment.DISCORD_SMOKE_ARTIFACT_PATH ?? `artifacts/discord-${mode}-${new Date().toISOString()}.json`,
  }
}

async function defaultListCommands(input: {
  token: string
  clientId: string
  scope: CommandScope
}): Promise<readonly RegisteredCommand[]> {
  const rest = new REST().setToken(input.token)
  const route =
    input.scope.kind === 'guild'
      ? Routes.applicationGuildCommands(input.clientId, input.scope.guildId)
      : Routes.applicationCommands(input.clientId)
  const result = await rest.get(route)
  if (!Array.isArray(result)) throw new Error('Discord command registration response was invalid')
  return result.filter(
    (command): command is RegisteredCommand =>
      Boolean(command) && typeof command === 'object' && typeof (command as { name?: unknown }).name === 'string',
  )
}

async function defaultWriteArtifact(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, contents)
}

async function assertHealth(
  fetcher: NonNullable<SmokeDependencies['fetcher']>,
  apiUrl: string,
  path: '/health/live' | '/health/ready',
  expected: 'live' | 'ready',
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_000)
  try {
    const response = await fetcher(`${apiUrl}${path}`, { signal: controller.signal })
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null
    if (!response.ok || body?.status !== expected) throw new Error(`API ${expected} smoke check failed`)
  } finally {
    clearTimeout(timeout)
  }
}

export async function runDiscordSmoke(
  mode: DiscordSmokeEnvironment,
  {
    environment = process.env,
    listCommands = defaultListCommands,
    fetcher = fetch,
    now = () => new Date(),
    writeArtifact = defaultWriteArtifact,
  }: SmokeDependencies = {},
): Promise<SmokeArtifact> {
  const configuration = requireConfiguration(environment, mode)
  const registered = await listCommands(configuration)
  const names = new Set(registered.map((command) => command.name))
  const missingCommands = requiredCommands.filter((name) => !names.has(name))
  if (missingCommands.length > 0) {
    throw new Error(`Missing registered Discord commands: ${missingCommands.join(', ')}`)
  }

  await Promise.all([
    assertHealth(fetcher, configuration.apiUrl, '/health/live', 'live'),
    assertHealth(fetcher, configuration.apiUrl, '/health/ready', 'ready'),
  ])

  const artifact: SmokeArtifact = {
    schema: 1,
    environment: mode,
    status: 'preflight-passed',
    checkedAt: now().toISOString(),
    liveDeploymentClaim: false,
    preflightChecks: [
      { name: 'discord-command-registration', status: 'passed' },
      { name: 'api-liveness', status: 'passed' },
      { name: 'api-readiness', status: 'passed' },
    ],
    interactionChecks: [
      { command: '/player', status: 'pending', requiredEvidence: 'Normal and degraded staging or production response' },
      { command: '/clan', status: 'pending', requiredEvidence: 'Normal and degraded staging or production response' },
      { command: '/status', status: 'pending', requiredEvidence: 'Live, ready, and degraded response' },
    ],
  }
  await writeArtifact(configuration.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`)
  return artifact
}

if (import.meta.main) {
  const mode = process.argv[2]
  if (mode !== 'staging-guild' && mode !== 'production') {
    console.error('Usage: bun run src/smoke.ts <staging-guild|production>')
    process.exitCode = 1
  } else {
    void runDiscordSmoke(mode)
      .then(() => console.log(`Discord ${mode} preflight passed; live interaction checks remain pending.`))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : 'Discord smoke preflight failed')
        process.exitCode = 1
      })
  }
}

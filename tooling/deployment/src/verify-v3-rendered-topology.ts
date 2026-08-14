#!/usr/bin/env bun

import { posix } from 'node:path'

const expectedServices = [
  'api',
  'migration',
  'operations-worker',
  'postgres',
  'replay-simulator-runtime',
  'replay-simulator-worker',
  'web',
] as const

const expectedBuildTargets: Record<string, string> = {
  api: 'api',
  migration: 'migration',
  'operations-worker': 'operations-worker',
  postgres: 'postgres',
  'replay-simulator-runtime': 'replay-simulator-runtime',
  'replay-simulator-worker': 'replay-simulator-worker',
  web: 'web',
}

const expectedSecretFiles: Record<string, string> = {
  brawlhalla_api_key: 'brawlhalla-api-key',
  discord_internal_api_secret: 'discord-internal-api-secret',
  migration_database_url: 'migration-database-url',
  internal_api_secret: 'internal-api-secret',
  metrics_scrape_secret: 'metrics-scrape-secret',
  otel_authorization: 'otel-authorization',
  postgres_owner_password: 'postgres-owner-password',
  postgres_runtime_password: 'postgres-runtime-password',
  r2_access_key_id: 'r2-access-key-id',
  r2_bucket: 'r2-bucket',
  r2_endpoint: 'r2-endpoint',
  r2_secret_access_key: 'r2-secret-access-key',
  refresh_trust_cookie_secret: 'refresh-trust-cookie-secret',
  runtime_database_url: 'runtime-database-url',
}

const expectedServiceSecrets: Record<string, string[]> = {
  api: [
    'discord_internal_api_secret',
    'internal_api_secret',
    'metrics_scrape_secret',
    'otel_authorization',
    'refresh_trust_cookie_secret',
    'r2_access_key_id',
    'r2_bucket',
    'r2_endpoint',
    'r2_secret_access_key',
    'runtime_database_url',
  ],
  migration: ['migration_database_url'],
  'operations-worker': ['brawlhalla_api_key', 'metrics_scrape_secret', 'otel_authorization', 'runtime_database_url'],
  postgres: ['postgres_owner_password', 'postgres_runtime_password'],
  'replay-simulator-runtime': [],
  'replay-simulator-worker': [
    'metrics_scrape_secret',
    'otel_authorization',
    'r2_access_key_id',
    'r2_bucket',
    'r2_endpoint',
    'r2_secret_access_key',
    'runtime_database_url',
  ],
  web: ['internal_api_secret', 'metrics_scrape_secret', 'otel_authorization'],
}

export function verifyV3RenderedTopology(document: unknown): string[] {
  if (!isRecord(document)) return ['rendered Compose must be an object']
  const services = isRecord(document.services) ? document.services : {}
  const networks = isRecord(document.networks) ? document.networks : {}
  const secrets = isRecord(document.secrets) ? document.secrets : {}
  const violations: string[] = []

  checkExactKeys(violations, 'services', services, [...expectedServices])
  const volumes = isRecord(document.volumes) ? document.volumes : {}
  checkExactKeys(violations, 'networks', networks, ['application'])
  checkExactKeys(violations, 'volumes', volumes, [
    'brawlhalla-replay-spike-game',
    'brawlhalla-replay-spike-home',
    'brawlhalla-replay-spike-proton',
  ])
  checkExactKeys(violations, 'secrets', secrets, Object.keys(expectedSecretFiles))

  const application = networks.application
  if (!isRecord(application) || application.external !== true || application.name !== 'brawltome-v3') {
    violations.push('application must be external network brawltome-v3')
  }

  for (const name of expectedServices) {
    const service = services[name]
    if (!isRecord(service)) {
      violations.push(`${name} must be a service object`)
      continue
    }
    if (!isRecord(service.networks) || !sameValues(Object.keys(service.networks), ['application'])) {
      violations.push(`${name} must use only the application network`)
    }
    if (service.ports !== undefined && (!Array.isArray(service.ports) || service.ports.length > 0)) {
      violations.push(`${name} must not publish ports`)
    }
    if (service.labels !== undefined && !isRecord(service.labels)) {
      violations.push(`${name} labels must be an object`)
    } else if (hasTraefikLabels(service.labels)) {
      violations.push(`${name} must not have Traefik labels`)
    }
    if (!sameSecretAttachments(service.secrets, expectedServiceSecrets[name])) {
      violations.push(`${name} secrets must match approved attachments exactly`)
    }
    if (name !== 'migration' && readPath(service, 'deploy', 'replicas') !== 1) {
      violations.push(`${name} must have exactly one replica`)
    }
    checkHealthcheck(violations, name, service)
    checkResourcePolicy(violations, name, service)
    const target = expectedBuildTargets[name]
    if (target && readPath(service, 'build', 'target') !== target) {
      violations.push(`${name} must use build target ${target}`)
    }
    checkRuntimeHardening(violations, name, service)
    checkSecretEnvironment(violations, name, service.environment)
    checkSecretMountShadowing(
      violations,
      name,
      service,
      expectedServiceSecrets[name].map((secret) => `/run/secrets/${secret}`),
    )
  }

  for (const volumeName of [
    'brawlhalla-replay-spike-game',
    'brawlhalla-replay-spike-home',
    'brawlhalla-replay-spike-proton',
  ]) {
    const volume = volumes[volumeName]
    if (!isRecord(volume) || volume.external !== true) violations.push(`${volumeName} must be an external volume`)
  }

  const worker = services['operations-worker']
  if (isRecord(worker)) {
    if (readPath(worker, 'environment', 'BRAWLHALLA_V1_REQUEST_LIMIT') !== '1') {
      violations.push('operations-worker must retain the limit-1 Brawlhalla request control')
    }
    if (readPath(worker, 'environment', 'OPERATIONS_TOTAL_CONCURRENCY') !== '3') {
      violations.push('operations-worker admission must include the replay slot')
    }
    if (readPath(worker, 'environment', 'OPERATIONS_EXECUTION_SLOTS') !== '2') {
      violations.push('operations-worker must retain two general execution slots')
    }
    if (readPath(worker, 'environment', 'OPERATIONS_INTERACTIVE_RESERVATION') !== '1') {
      violations.push('operations-worker must retain one reserved interactive slot')
    }
    if (readPath(worker, 'environment', 'OPERATIONS_INTERACTIVE_CONCURRENCY') !== '2') {
      violations.push('operations-worker must retain two interactive operation slots')
    }
    if (readPath(worker, 'environment', 'OPERATIONS_REPLAY_SIMULATION_CONCURRENCY') !== '1') {
      violations.push('operations-worker must configure one replay simulation class slot')
    }
  }

  const replay = services['replay-simulator-worker']
  if (isRecord(replay)) {
    if (readPath(replay, 'environment', 'OPERATIONS_TOTAL_CONCURRENCY') !== '3') {
      violations.push('replay-simulator-worker admission must match operations-worker total concurrency')
    }
    if (readPath(replay, 'environment', 'OPERATIONS_EXECUTION_SLOTS') !== '1') {
      violations.push('replay-simulator-worker must run one execution slot')
    }
    if (readPath(replay, 'environment', 'OPERATIONS_REPLAY_SIMULATION_CONCURRENCY') !== '1') {
      violations.push('replay-simulator-worker must configure one replay simulation class slot')
    }
    if (readPath(replay, 'environment', 'REPLAY_SIMULATOR_RUNTIME_URL') !== 'http://replay-simulator-runtime:3004') {
      violations.push('replay-simulator-worker must call the private runtime service')
    }
    const revision = readPath(replay, 'environment', 'BRAWLTOME_REPOSITORY_REVISION')
    if (typeof revision !== 'string' || !/^[0-9a-f]{7,64}$/i.test(revision)) {
      violations.push('replay-simulator-worker must receive a validated repository revision')
    }
  }

  const replayRuntime = services['replay-simulator-runtime']
  if (isRecord(replayRuntime)) {
    if (readPath(replayRuntime, 'environment', 'PLAYBACK_MODE') !== 'seek-end') {
      violations.push('replay-simulator-runtime must use seek-end playback')
    }
    if (
      readPath(replayRuntime, 'build', 'args', 'REPLAY_SIMULATOR_RUNTIME_BASE') !==
      'brawlhalla-replay-spike:steam-replay'
    ) {
      violations.push('replay-simulator-runtime must validate the approved Steam replay base image')
    }
  }

  const web = services.web
  if (isRecord(web)) {
    if (readPath(web, 'environment', 'INTERNAL_API_URL') !== 'http://api:3000') {
      violations.push('web must use the internal API origin for server calls')
    }
    if (readPath(web, 'build', 'args', 'NEXT_PUBLIC_API_URL') !== 'https://v3-api.brawltome.app') {
      violations.push('web must retain the approved future browser API origin')
    }
  }

  for (const [key, file] of Object.entries(expectedSecretFiles)) {
    const secret = secrets[key]
    if (
      !isRecord(secret) ||
      secret.name !== `brawltome-v3_${key}` ||
      secret.file !== `/var/lib/brawltome-v3-secrets/${file}`
    ) {
      violations.push(`${key} must use the approved host secret file`)
    }
  }

  return violations
}

function checkExactKeys(
  violations: string[],
  subject: string,
  value: Record<string, unknown>,
  expected: string[],
): void {
  if (!sameValues(Object.keys(value), expected))
    violations.push(`${subject} must be exactly: ${[...expected].sort().join(', ')}`)
}

function checkHealthcheck(violations: string[], name: string, service: Record<string, unknown>): void {
  if (name === 'migration') return
  const healthcheck = service.healthcheck
  if (!isRecord(healthcheck)) {
    violations.push(`${name} must define a healthcheck`)
    return
  }
  const expectedPort =
    name === 'replay-simulator-runtime' ? '3004' : name === 'replay-simulator-worker' ? '3003' : undefined
  if (!expectedPort) return
  const command = Array.isArray(healthcheck.test) ? healthcheck.test.join(' ') : ''
  if (!command.includes(`localhost:${expectedPort}/health/ready`)) {
    violations.push(`${name} healthcheck must verify readiness on its private health port`)
  }
  if (healthcheck.interval !== '10s' || healthcheck.timeout !== '3s' || healthcheck.retries !== 12) {
    violations.push(`${name} healthcheck timing must match the approved policy`)
  }
}

function checkResourcePolicy(violations: string[], name: string, service: Record<string, unknown>): void {
  const limits = readPath(service, 'deploy', 'resources', 'limits')
  if (!isRecord(limits)) {
    violations.push(`${name} must define resource limits`)
    return
  }
  if (name === 'replay-simulator-runtime') {
    const cpu = String(limits.cpus)
    const memory = String(limits.memory)
    if ((cpu !== '2.0' && cpu !== '2') || (memory !== '6G' && memory !== '6442450944') || limits.pids !== 1024) {
      violations.push('replay-simulator-runtime resources must be exactly 2 CPU, 6G memory, and 1024 PIDs')
    }
    if (!asStringArray(service.tmpfs).some((mount) => mount.includes('/dev/shm') && mount.includes('size=512m'))) {
      violations.push('replay-simulator-runtime must reserve 512M shm')
    }
  }
}

function checkRuntimeHardening(violations: string[], name: string, service: Record<string, unknown>): void {
  if (service.read_only !== true) violations.push(`${name} root filesystem must remain read-only`)
  if (service.privileged !== undefined) violations.push(`${name} must not set privileged mode`)
  if (service.cap_add !== undefined) violations.push(`${name} must not add capabilities`)
  for (const field of ['cgroup', 'devices', 'ipc', 'network_mode', 'pid', 'uts', 'volumes_from']) {
    if (service[field] !== undefined) violations.push(`${name} must not set ${field}`)
  }
  if (name === 'postgres') {
    if (service.user !== '70:70') violations.push('postgres must run as 70:70')
  } else if (name === 'replay-simulator-runtime') {
    if (service.user !== '10001:10001') violations.push('replay-simulator-runtime must run as 10001:10001')
  } else if (service.user !== undefined) {
    violations.push(`${name} must not override the image user`)
  }
  if (service.init !== true) violations.push(`${name} must retain an init process`)
  if (!sameValues(asStringArray(service.cap_drop), ['ALL'])) violations.push(`${name} must drop all capabilities`)
  const expectedSecurityOpt =
    name === 'replay-simulator-runtime'
      ? ['apparmor:brawlhalla-steam', 'no-new-privileges:true', 'seccomp:unconfined']
      : ['no-new-privileges:true']
  if (!sameValues(asStringArray(service.security_opt), expectedSecurityOpt)) {
    violations.push(`${name} must retain approved security options`)
  }
  if (service.command != null || service.entrypoint != null) {
    violations.push(`${name} must not override the image command or entrypoint`)
  }
  if (name === 'postgres') {
    if (!hasBind(service.volumes, '/srv/brawltome-v3/postgres', '/var/lib/postgresql/data')) {
      violations.push('postgres must bind only the approved data filesystem')
    }
  } else if (name === 'replay-simulator-runtime') {
    if (!hasReplayVolumes(service.volumes)) {
      violations.push('replay-simulator-runtime must mount only approved external replay volumes')
    }
  } else if (service.volumes !== undefined && (!Array.isArray(service.volumes) || service.volumes.length > 0)) {
    violations.push(`${name} must not add volumes`)
  }
  if (service.configs !== undefined && (!Array.isArray(service.configs) || service.configs.length > 0)) {
    violations.push(`${name} must not add configs`)
  }
}

function checkSecretEnvironment(violations: string[], name: string, value: unknown): void {
  if (!isRecord(value)) return
  const secretNames = new Set([
    'BRAWLHALLA_API_KEY',
    'DATABASE_URL',
    'DISCORD_INTERNAL_API_SECRET',
    'DISCORD_TOKEN',
    'INTERNAL_API_SECRET',
    'METRICS_SCRAPE_SECRET',
    'OTEL_EXPORTER_OTLP_AUTHORIZATION',
    'POSTGRES_PASSWORD',
    'R2_ACCESS_KEY_ID',
    'R2_BUCKET',
    'R2_ENDPOINT',
    'R2_SECRET_ACCESS_KEY',
    'REFRESH_TRUST_COOKIE_SECRET',
  ])
  if (Object.keys(value).some((key) => secretNames.has(key))) {
    violations.push(`${name} must not receive raw secret environment variables`)
  }
}

function checkSecretMountShadowing(
  violations: string[],
  name: string,
  service: Record<string, unknown>,
  secretTargets: string[],
): void {
  if (service.tmpfs === undefined) return
  if (!Array.isArray(service.tmpfs) || service.tmpfs.some((mount) => typeof mount !== 'string')) {
    violations.push(`${name} tmpfs must be rendered strings`)
    return
  }
  const shadows = service.tmpfs.some((mount) => {
    const target = posix.normalize(String(mount).split(':', 1)[0] ?? '')
    return secretTargets.some((secret) => secret === target || secret.startsWith(`${target}/`))
  })
  if (shadows) violations.push(`${name} tmpfs must not shadow secret targets`)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

function hasBind(value: unknown, source: string, target: string): boolean {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    isRecord(value[0]) &&
    value[0].type === 'bind' &&
    value[0].source === source &&
    value[0].target === target
  )
}

function hasReplayVolumes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !isRecord(item))) return false
  const expected = new Map([
    ['brawlhalla-replay-spike-home', '/home/runner'],
    ['brawlhalla-replay-spike-game', '/game'],
    ['brawlhalla-replay-spike-proton', '/proton'],
  ])
  for (const item of value) {
    if (item.type !== 'volume' || typeof item.source !== 'string' || typeof item.target !== 'string') return false
    if (expected.get(item.source) !== item.target) return false
    expected.delete(item.source)
  }
  return expected.size === 0
}

function hasTraefikLabels(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).some((key) => key.toLowerCase().startsWith('traefik.'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPath(value: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

function sameSecretAttachments(value: unknown, expected: string[]): boolean {
  if (expected.length === 0 && value === undefined) return true
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) return false
  const actual = value.map((item) => String(item.source))
  return sameValues(actual, expected) && value.every((item) => item.target === `/run/secrets/${String(item.source)}`)
}

function sameValues(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index])
}

if (import.meta.main) {
  try {
    const violations = verifyV3RenderedTopology(JSON.parse(await Bun.stdin.text()))
    for (const violation of violations) console.error(`v3-rendered-topology: ${violation}`)
    if (violations.length > 0) process.exit(1)
    console.log('Rendered V3 topology verified.')
  } catch {
    console.error('v3-rendered-topology: input must be valid Docker Compose JSON')
    process.exit(1)
  }
}

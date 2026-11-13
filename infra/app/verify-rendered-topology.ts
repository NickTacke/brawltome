#!/usr/bin/env bun

import { posix } from 'node:path'

const expectedServices = ['migration', 'postgres', 'api', 'operations-worker', 'web', 'site'] as const
const releaseCommitPattern = /^[0-9a-f]{40}$/

const expectedServiceNetworks: Record<string, string[]> = {
  api: ['application', 'observability'],
  migration: ['application'],
  'operations-worker': ['application', 'observability'],
  postgres: ['application'],
  // Dokploy only attaches its network to services with a Dokploy domain, and site is routed from compose instead
  site: ['application', 'dokploy-network'],
  web: ['application', 'observability'],
}

const expectedDependencies: Record<string, [service: string, condition: string]> = {
  api: ['migration', 'service_completed_successfully'],
  migration: ['postgres', 'service_healthy'],
  'operations-worker': ['migration', 'service_completed_successfully'],
  site: ['api', 'service_healthy'],
  web: ['api', 'service_healthy'],
}

const expectedHealthPaths: Record<string, string> = {
  api: '/health/ready',
  postgres: 'pg_isready',
  'operations-worker': '/health/ready',
  // Liveness only: web readiness depends on the API and PostgreSQL, and an unhealthy container is dropped by the
  // proxy, which would take the whole site offline instead of rendering its error state during a database outage.
  site: '/health/live',
  web: '/api/health/live',
}

const expectedStopGracePeriods: Record<string, string> = {
  api: '1m10s',
  postgres: '30s',
  'operations-worker': '1m10s',
  site: '20s',
  web: '20s',
}

const expectedSecretFiles: Record<string, string> = {
  brawlhalla_api_key: 'brawlhalla-api-key',
  discord_client_secret: 'discord-client-secret',
  discord_internal_api_secret: 'discord-internal-api-secret',
  migration_database_url: 'migration-database-url',
  internal_api_secret: 'internal-api-secret',
  matches_preview_token: 'matches-preview-token',
  metrics_scrape_secret: 'metrics-scrape-secret',
  otel_authorization: 'otel-authorization',
  postgres_owner_password: 'postgres-owner-password',
  postgres_runtime_password: 'postgres-runtime-password',
  refresh_trust_cookie_secret: 'refresh-trust-cookie-secret',
  runtime_database_url: 'runtime-database-url',
  turnstile_secret_key: 'turnstile-secret-key',
}

const expectedServiceSecrets: Record<string, string[]> = {
  api: [
    'discord_client_secret',
    'discord_internal_api_secret',
    'internal_api_secret',
    'metrics_scrape_secret',
    'otel_authorization',
    'refresh_trust_cookie_secret',
    'runtime_database_url',
    'turnstile_secret_key',
  ],
  migration: ['migration_database_url'],
  'operations-worker': ['brawlhalla_api_key', 'metrics_scrape_secret', 'otel_authorization', 'runtime_database_url'],
  postgres: ['postgres_owner_password', 'postgres_runtime_password'],
  site: ['internal_api_secret'],
  web: ['internal_api_secret', 'matches_preview_token', 'metrics_scrape_secret', 'otel_authorization'],
}

// the pages site has taken over from web. everything else on brawltome.app, including banners, legend portraits and
// the favicon, falls through to Dokploy's plain Host rule for web. only the .svg weapon icons move, web serves its own
// .png ones from the same directory. the silhouette and one renamed portrait only exist on site. `compose config` keeps the $$ escape, the container label gets a single $
const siteRouterRule =
  'Host(`brawltome.app`) && (PathPrefix(`/player/`) || PathPrefix(`/guild/`) || PathPrefix(`/clan/`) || ' +
  'Path(`/`) || Path(`/matches`) || Path(`/leaderboard`) || Path(`/guilds`) || Path(`/queue`) || Path(`/account`) || Path(`/privacy`) || Path(`/terms`) || PathPrefix(`/assets/`) || PathPrefix(`/_serverFn/`) || ' +
  'Path(`/stats`) || Path(`/learn`) || Path(`/tournaments`) || Path(`/images/legends/random.svg`) || ' +
  'Path(`/images/legends/avatars/qinghua-and-baobao.png`) || PathPrefix(`/images/flags/`) || PathPrefix(`/images/banners/`) || PathPrefix(`/patch-images/`) || PathRegexp(`^/images/weapons/[^/]+\\.svg$$`))'

const expectedSiteLabels: Record<string, string> = {
  'traefik.docker.network': 'dokploy-network',
  'traefik.enable': 'true',
  'traefik.http.routers.brawltome-site.entrypoints': 'websecure',
  // Dokploy's Host rule for web gets the default priority, its length, so any explicit value this high wins
  'traefik.http.routers.brawltome-site.priority': '1000',
  'traefik.http.routers.brawltome-site.rule': siteRouterRule,
  'traefik.http.routers.brawltome-site.service': 'brawltome-site',
  'traefik.http.routers.brawltome-site.tls.certresolver': 'letsencrypt',
  // the retry and the serving check are what let deploy.sh roll site without dropping requests
  'traefik.http.middlewares.brawltome-site-retry.retry.attempts': '3',
  'traefik.http.routers.brawltome-site.middlewares': 'brawltome-site-retry',
  'traefik.http.services.brawltome-site.loadbalancer.healthcheck.interval': '2s',
  'traefik.http.services.brawltome-site.loadbalancer.healthcheck.path': '/health/serving',
  'traefik.http.services.brawltome-site.loadbalancer.healthcheck.timeout': '1s',
  'traefik.http.services.brawltome-site.loadbalancer.server.port': '3000',
}

export function verifyAppRenderedTopology(document: unknown): string[] {
  if (!isRecord(document)) return ['rendered Compose must be an object']

  const services = isRecord(document.services) ? document.services : {}
  const networks = isRecord(document.networks) ? document.networks : {}
  const secrets = isRecord(document.secrets) ? document.secrets : {}
  const violations: string[] = []

  checkExactKeys(violations, 'services', services, [...expectedServices])
  checkExactKeys(violations, 'networks', networks, ['application', 'dokploy-network', 'observability'])
  checkExactKeys(violations, 'secrets', secrets, Object.keys(expectedSecretFiles))

  const application = networks.application

  if (!isRecord(application) || application.external !== true || application.name !== 'brawltome') {
    violations.push('application must be external network brawltome')
  }

  const observability = networks.observability

  if (!isRecord(observability) || observability.external !== true || observability.name !== 'brawltome-observability') {
    violations.push('observability must be external network brawltome-observability')
  }

  const dokploy = networks['dokploy-network']

  if (!isRecord(dokploy) || dokploy.external !== true || dokploy.name !== 'dokploy-network') {
    violations.push('dokploy-network must be external network dokploy-network')
  }

  for (const name of expectedServices) {
    const service = services[name]

    if (!isRecord(service)) {
      violations.push(`${name} must be a service object`)
      continue
    }

    if (!isRecord(service.networks) || !sameValues(Object.keys(service.networks), expectedServiceNetworks[name])) {
      violations.push(`${name} networks must match the approved topology`)
    }

    if (service.ports !== undefined && (!Array.isArray(service.ports) || service.ports.length > 0)) {
      violations.push(`${name} must not publish ports`)
    }

    checkLabels(violations, name, service.labels)

    if (!sameSecretAttachments(service.secrets, expectedServiceSecrets[name])) {
      violations.push(`${name} secrets must match approved attachments exactly`)
    }

    if (name !== 'migration' && readPath(service, 'deploy', 'replicas') !== 1) {
      violations.push(`${name} must have exactly one replica`)
    }

    checkImageSource(violations, name, service)
    checkRuntimeContract(violations, name, service)
    checkRuntimeHardening(violations, name, service)
    checkSecretEnvironment(violations, name, service.environment)

    checkSecretMountShadowing(
      violations,
      name,
      service,
      expectedServiceSecrets[name].map((secret) => `/run/secrets/${secret}`),
    )
  }

  const worker = services['operations-worker']

  if (isRecord(worker)) {
    if (readPath(worker, 'environment', 'BRAWLHALLA_V1_REQUEST_LIMIT') !== '1800') {
      violations.push('operations-worker must retain the V1 safety ceiling of 1800 requests per five minutes')
    }

    if (readPath(worker, 'environment', 'LEADERBOARD_PAGE_DEPTH') !== '20') {
      violations.push('operations-worker must retain adaptive leaderboard depth 20')
    }

    if (readPath(worker, 'environment', 'LEADERBOARD_INTERVAL_MS') !== '900000') {
      violations.push('operations-worker must retain 15-minute leaderboard cadence')
    }

    if (readPath(worker, 'environment', 'OPERATIONS_TOTAL_CONCURRENCY') !== '4') {
      violations.push('operations-worker must retain four total operation slots')
    }

    if (readPath(worker, 'environment', 'OPERATIONS_INTERACTIVE_RESERVATION') !== '1') {
      violations.push('operations-worker must retain one reserved interactive slot')
    }

    if (readPath(worker, 'environment', 'OPERATIONS_INTERACTIVE_CONCURRENCY') !== '2') {
      violations.push('operations-worker must retain two interactive operation slots')
    }

    if (readPath(worker, 'environment', 'OPERATIONS_LEADERBOARD_CONCURRENCY') !== '2') {
      violations.push('operations-worker must retain two leaderboard operation slots')
    }

    if (readPath(worker, 'environment', 'SOURCE_BACKGROUND_HEADROOM') !== '30') {
      violations.push('operations-worker must retain 30 source units of on-demand headroom')
    }

    if (readPath(worker, 'environment', 'SOURCE_UNAVAILABLE_RETRY_MS') !== '60000') {
      violations.push('operations-worker must retain the 60-second source outage deferral')
    }
  }

  const api = services.api

  if (isRecord(api)) {
    if (readPath(api, 'environment', 'CORS_ORIGIN') !== 'https://brawltome.app') {
      violations.push('api must allow only the final public web origin')
    }

    const discordClientId = readPath(api, 'environment', 'DISCORD_CLIENT_ID')

    if (typeof discordClientId !== 'string' || !/^\d{17,20}$/.test(discordClientId)) {
      violations.push('api must receive a Discord OAuth client ID')
    }

    if (readPath(api, 'environment', 'DISCORD_REDIRECT_URI') !== 'https://api.brawltome.app/auth/discord/callback') {
      violations.push('api must use the public Discord OAuth callback')
    }

    if (readPath(api, 'environment', 'STEAM_RETURN_URL') !== 'https://api.brawltome.app/auth/steam/callback') {
      violations.push('api must use the public Steam OpenID callback')
    }

    if (readPath(api, 'environment', 'STEAM_REALM') !== 'https://api.brawltome.app') {
      violations.push('api must use the public Steam OpenID realm')
    }

    if (readPath(api, 'environment', 'WEB_ORIGIN') !== 'https://brawltome.app') {
      violations.push('api must use the final public web origin')
    }
  }

  for (const name of ['web', 'site']) {
    const service = services[name]

    if (isRecord(service) && readPath(service, 'environment', 'INTERNAL_API_URL') !== 'http://api:3000') {
      violations.push(`${name} must use the internal API origin for server calls`)
    }
  }

  for (const [key, file] of Object.entries(expectedSecretFiles)) {
    const secret = secrets[key]

    if (
      !isRecord(secret) ||
      secret.name !== `brawltome_${key}` ||
      secret.file !== `/var/lib/brawltome-secrets/${file}`
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

// Postgres is built from the repository; every other service runs the image CI pushed for the release commit.
function checkImageSource(violations: string[], name: string, service: Record<string, unknown>): void {
  if (name === 'postgres') {
    if (readPath(service, 'build', 'target') !== 'postgres') violations.push('postgres must use build target postgres')

    return
  }

  if (service.build !== undefined) violations.push(`${name} must not be built on the server`)

  const imagePrefix = `ghcr.io/nicktacke/brawltome-${name}:`
  const image = typeof service.image === 'string' ? service.image : ''
  const tag = image.slice(imagePrefix.length)

  if (!image.startsWith(imagePrefix) || !releaseCommitPattern.test(tag)) {
    violations.push(`${name} must use image ghcr.io/nicktacke/brawltome-${name} tagged with the release commit`)
  }
}

function checkLabels(violations: string[], name: string, labels: unknown): void {
  if (labels !== undefined && !isRecord(labels)) {
    violations.push(`${name} labels must be an object`)

    return
  }

  if (name === 'site') {
    if (!isRecord(labels) || !sameLabels(labels, expectedSiteLabels)) {
      violations.push('site labels must match the approved router exactly')
    }

    return
  }

  if (hasUnapprovedTraefikLabels(labels)) {
    violations.push(`${name} must not have Traefik labels beyond retry and health checks`)
  }
}

function checkRuntimeContract(violations: string[], name: string, service: Record<string, unknown>): void {
  const dependency = expectedDependencies[name]

  if (
    dependency &&
    (!isRecord(service.depends_on) ||
      !sameValues(Object.keys(service.depends_on), [dependency[0]]) ||
      readPath(service, 'depends_on', dependency[0], 'condition') !== dependency[1])
  ) {
    violations.push(`${name} dependencies must match the approved topology`)
  }

  const healthPath = expectedHealthPaths[name]
  const healthCommand = asStringArray(readPath(service, 'healthcheck', 'test')).join(' ')

  if (healthPath && !healthCommand.includes(healthPath)) {
    violations.push(`${name} health check must use ${healthPath}`)
  }

  const stopGracePeriod = expectedStopGracePeriods[name]

  if (stopGracePeriod && service.stop_grace_period !== stopGracePeriod) {
    violations.push(`${name} must retain stop grace period ${stopGracePeriod}`)
  }

  const memory = readPath(service, 'deploy', 'resources', 'limits', 'memory')
  const pids = readPath(service, 'deploy', 'resources', 'limits', 'pids')

  if (typeof memory !== 'string' || typeof pids !== 'number' || pids <= 0) {
    violations.push(`${name} must retain bounded memory and PID resources`)
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
  } else if (service.user !== undefined) {
    violations.push(`${name} must not override the image user`)
  }

  if (service.init !== true) violations.push(`${name} must retain an init process`)

  if (!sameValues(asStringArray(service.cap_drop), ['ALL'])) violations.push(`${name} must drop all capabilities`)

  if (!sameValues(asStringArray(service.security_opt), ['no-new-privileges:true'])) {
    violations.push(`${name} must retain no-new-privileges`)
  }

  if (service.command != null || service.entrypoint != null) {
    violations.push(`${name} must not override the image command or entrypoint`)
  }

  if (name === 'postgres') {
    if (!hasBind(service.volumes, '/srv/brawltome/postgres', '/var/lib/postgresql/data')) {
      violations.push('postgres must bind only the approved data filesystem')
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
    'DEAD_LETTER_DATABASE_URL',
    'DEAD_LETTER_OPERATOR_TOKEN',
    'DEAD_LETTER_OPERATOR_TOKENS',
    'DISCORD_INTERNAL_API_SECRET',
    'DISCORD_TOKEN',
    'INTERNAL_API_SECRET',
    'MATCHES_PREVIEW_TOKEN',
    'METRICS_SCRAPE_SECRET',
    'OTEL_EXPORTER_OTLP_AUTHORIZATION',
    'POSTGRES_DEAD_LETTER_PASSWORD',
    'POSTGRES_PASSWORD',
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

// Dokploy owns routing for every service but site. Compose may only tune the routes Dokploy creates (retries and load balancer health checks for
// zero-downtime deploys); without traefik.enable or a rule these labels cannot expose anything.
const approvedTraefikLabel =
  /^traefik\.http\.(?:middlewares\.[a-z0-9-]+\.retry\.[a-z]+|routers\.[a-z0-9-]+\.middlewares|services\.[a-z0-9-]+\.loadbalancer\.healthcheck\.[a-z]+)$/

function hasUnapprovedTraefikLabels(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).some((key) => key.toLowerCase().startsWith('traefik.') && !approvedTraefikLabel.test(key))
  )
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
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) return false

  const actual = value.map((item) => String(item.source))

  return sameValues(actual, expected) && value.every((item) => item.target === `/run/secrets/${String(item.source)}`)
}

function sameLabels(actual: Record<string, unknown>, expected: Record<string, string>): boolean {
  return (
    sameValues(Object.keys(actual), Object.keys(expected)) &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  )
}

function sameValues(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()

  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index])
}

if (import.meta.main) {
  try {
    const violations = verifyAppRenderedTopology(JSON.parse(await Bun.stdin.text()))

    for (const violation of violations) console.error(`app-rendered-topology: ${violation}`)
    if (violations.length > 0) process.exit(1)

    console.log('Rendered application topology verified.')
  } catch {
    console.error('app-rendered-topology: input must be valid Docker Compose JSON')
    process.exit(1)
  }
}

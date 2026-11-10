import { beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyAppRenderedTopology } from '../verify-rendered-topology'

const root = resolve(import.meta.dir, '../../..')

// `docker compose config` cold-starts in ~6 s on CI runners, past bun's 5 s test timeout. Render once (warmed in
// beforeAll with a generous deadline) and hand every test its own parsed copy to mutate.
let renderedJson: string | undefined

function renderedTopology(): Record<string, unknown> {
  renderedJson ??= renderTopologyJson()

  return JSON.parse(renderedJson)
}

function renderTopologyJson(): string {
  const result = Bun.spawnSync({
    cmd: ['docker', 'compose', '-f', 'infra/app/compose.yml', 'config', '--format', 'json'],
    cwd: root,
    env: {
      ...process.env,
      BRAWLTOME_IMAGE_TAG: '0000000000000000000000000000000000000000',
      DISCORD_CLIENT_ID: '123456789012345678',
      POSTGRES_DATA_ROOT: '/srv/brawltome/postgres',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  expect(result.exitCode, result.stderr.toString()).toBe(0)

  return result.stdout.toString()
}

function services(topology: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return topology.services as Record<string, Record<string, unknown>>
}

function siteLabels(topology: Record<string, unknown>): Record<string, string> {
  return services(topology).site.labels as Record<string, string>
}

const siteRuleLabel = 'traefik.http.routers.brawltome-site.rule'

describe('rendered application topology', () => {
  beforeAll(() => {
    renderedTopology()
  }, 60_000)

  test('accepts the exact rollout with site as the only service routed from compose', () => {
    expect(verifyAppRenderedTopology(renderedTopology())).toEqual([])
  })

  test('rejects collision-prone legacy runtime service names', () => {
    const topology = renderedTopology()
    const current = services(topology)

    current['legacy-api'] = current.api

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([expect.stringContaining('services must be exactly')]),
    )
  })

  test('rejects preview web origins after final public cutover', () => {
    const topology = renderedTopology()
    const environment = services(topology).api.environment as Record<string, string>

    environment.CORS_ORIGIN = 'https://preview.brawltome.app'
    environment.WEB_ORIGIN = 'https://preview.brawltome.app'

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'api must allow only the final public web origin',
        'api must use the final public web origin',
      ]),
    )
  })

  test.each([
    [
      'BRAWLHALLA_V1_REQUEST_LIMIT',
      '1',
      'operations-worker must retain the V1 safety ceiling of 1800 requests per five minutes',
    ],
    ['LEADERBOARD_PAGE_DEPTH', '1', 'operations-worker must retain adaptive leaderboard depth 20'],
    ['LEADERBOARD_INTERVAL_MS', '3600000', 'operations-worker must retain 15-minute leaderboard cadence'],
    ['OPERATIONS_TOTAL_CONCURRENCY', '3', 'operations-worker must retain four total operation slots'],
    ['OPERATIONS_INTERACTIVE_RESERVATION', '2', 'operations-worker must retain one reserved interactive slot'],
    ['OPERATIONS_INTERACTIVE_CONCURRENCY', '1', 'operations-worker must retain two interactive operation slots'],
    ['OPERATIONS_LEADERBOARD_CONCURRENCY', '1', 'operations-worker must retain two leaderboard operation slots'],
    ['SOURCE_BACKGROUND_HEADROOM', '31', 'operations-worker must retain 30 source units of on-demand headroom'],
    ['SOURCE_UNAVAILABLE_RETRY_MS', '1000', 'operations-worker must retain the 60-second source outage deferral'],
  ] as const)('rejects independent %s rollout drift', (variable, value, violation) => {
    const topology = renderedTopology()
    const workerEnvironment = services(topology)['operations-worker'].environment as Record<string, string>

    workerEnvironment[variable] = value
    expect(verifyAppRenderedTopology(topology)).toContain(violation)
  })

  test('rejects Discord activation, public exposure, and extra networks', () => {
    const topology = renderedTopology()
    const current = services(topology)

    current['discord-bot'] = { networks: { application: null } }
    current.api.ports = [{ published: '3000', target: 3000 }]
    current.web.labels = { 'Traefik.enable': 'true' }
    const networks = topology.networks as Record<string, unknown>

    networks.public = { external: true, name: 'dokploy-network' }

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('services must be exactly'),
        expect.stringContaining('networks must be exactly'),
        'api must not publish ports',
        'web must not have Traefik labels beyond retry and health checks',
      ]),
    )
  })

  test('allows only retry and health check tuning of the routes Dokploy owns', () => {
    const topology = renderedTopology()
    const current = services(topology)

    expect(Object.keys(current.api.labels as Record<string, string>)).toContain(
      'traefik.http.services.compose-program-virtual-microchip-uqxbrw-11-websecure.loadbalancer.healthcheck.path',
    )

    for (const label of [
      'traefik.enable',
      'traefik.http.routers.brawltome.rule',
      'traefik.http.services.brawltome.loadbalancer.server.port',
      'traefik.http.middlewares.brawltome.headers.customrequestheaders.x-forwarded-for',
    ]) {
      current.web.labels = { ...(current.web.labels as Record<string, string>), [label]: 'x' }

      expect(verifyAppRenderedTopology(topology)).toContain(
        'web must not have Traefik labels beyond retry and health checks',
      )

      const { [label]: _removed, ...approved } = current.web.labels as Record<string, string>

      current.web.labels = approved
    }

    expect(verifyAppRenderedTopology(topology)).toEqual([])
  })

  test('routes exactly the approved brawltome.app paths to site, above the Dokploy host rule', () => {
    const labels = siteLabels(renderedTopology())

    expect(labels).toEqual({
      'traefik.docker.network': 'dokploy-network',
      'traefik.enable': 'true',
      'traefik.http.routers.brawltome-site.entrypoints': 'websecure',
      'traefik.http.routers.brawltome-site.priority': '1000',
      [siteRuleLabel]:
        'Host(`brawltome.app`) && (PathPrefix(`/player/`) || PathPrefix(`/guild/`) || PathPrefix(`/clan/`) || ' +
        'Path(`/`) || Path(`/matches`) || Path(`/leaderboard`) || Path(`/guilds`) || Path(`/queue`) || Path(`/account`) || Path(`/privacy`) || Path(`/terms`) || PathPrefix(`/assets/`) || PathPrefix(`/_serverFn/`) || ' +
        'Path(`/stats`) || Path(`/learn`) || Path(`/tournaments`) || Path(`/images/legends/random.svg`) || Path(`/images/legends/avatars/qinghua-and-baobao.png`) || PathPrefix(`/images/flags/`) || PathPrefix(`/images/banners/`) || PathPrefix(`/patch-images/`) || PathRegexp(`^/images/weapons/[^/]+\\.svg$$`))',
      'traefik.http.routers.brawltome-site.service': 'brawltome-site',
      'traefik.http.routers.brawltome-site.tls.certresolver': 'letsencrypt',
      'traefik.http.services.brawltome-site.loadbalancer.server.port': '3000',
    })
  })

  test('sends the site weapon icons to site and leaves every web weapon icon on web', () => {
    // the rendered label keeps compose's $$ escape for the end anchor
    const rule = siteLabels(renderedTopology())[siteRuleLabel].replaceAll('$$', '$')
    const weaponPattern = new RegExp(/PathRegexp\(`([^`]+)`\)/.exec(rule)?.[1] ?? '$^')

    const iconPaths = (app: string) =>
      readdirSync(resolve(root, `apps/${app}/public/images/weapons`)).map((file) => `/images/weapons/${file}`)

    expect(iconPaths('site').filter((path) => !weaponPattern.test(path))).toEqual([])
    expect(iconPaths('web').filter((path) => weaponPattern.test(path))).toEqual([])
  })

  test.each([
    ['a widened rule', siteRuleLabel, 'Host(`brawltome.app`)'],
    ['a lower priority', 'traefik.http.routers.brawltome-site.priority', '1'],
    ['a plain http entrypoint', 'traefik.http.routers.brawltome-site.entrypoints', 'web'],
    ['an extra router', 'traefik.http.routers.brawltome-site-extra.rule', 'PathPrefix(`/`)'],
    ['an extra middleware', 'traefik.http.middlewares.brawltome-site.headers.customrequestheaders.x', 'y'],
  ])('rejects site routing drift: %s', (_drift, label, value) => {
    const topology = renderedTopology()

    services(topology).site.labels = { ...siteLabels(topology), [label]: value }

    expect(verifyAppRenderedTopology(topology)).toContain('site labels must match the approved router exactly')
  })

  test('rejects a site without its router', () => {
    const topology = renderedTopology()

    delete services(topology).site.labels

    expect(verifyAppRenderedTopology(topology)).toContain('site labels must match the approved router exactly')
  })

  test('keeps the Dokploy network on site only and external', () => {
    const topology = renderedTopology()
    const current = services(topology)
    const networks = topology.networks as Record<string, Record<string, unknown>>

    current.web.networks = { ...(current.web.networks as Record<string, unknown>), 'dokploy-network': null }
    current.api.networks = { ...(current.api.networks as Record<string, unknown>), 'dokploy-network': null }
    networks['dokploy-network'] = { name: 'dokploy-network' }

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'web networks must match the approved topology',
        'api networks must match the approved topology',
        'dokploy-network must be external network dokploy-network',
      ]),
    )
  })

  test('rejects site secret, network, health, hardening, and runtime drift', () => {
    const topology = renderedTopology()
    const site = services(topology).site
    const environment = site.environment as Record<string, string>
    const healthcheck = site.healthcheck as Record<string, unknown>

    site.secrets = [{ source: 'runtime_database_url', target: '/run/secrets/runtime_database_url' }]
    site.networks = { application: null, 'dokploy-network': null, observability: null }
    healthcheck.test = ['CMD', 'bun', '-e', "await fetch('http://localhost:3000/privacy')"]
    site.read_only = false
    site.cap_drop = []
    site.depends_on = {}
    site.stop_grace_period = '1s'
    environment.INTERNAL_API_URL = 'https://api.brawltome.app'
    site.image = 'ghcr.io/nicktacke/brawltome-web:' + '0'.repeat(40)
    site.deploy = { replicas: 2 }

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'site secrets must match approved attachments exactly',
        'site networks must match the approved topology',
        'site health check must use /health/live',
        'site root filesystem must remain read-only',
        'site must drop all capabilities',
        'site dependencies must match the approved topology',
        'site must retain stop grace period 20s',
        'site must use the internal API origin for server calls',
        'site must use image ghcr.io/nicktacke/brawltome-site tagged with the release commit',
        'site must have exactly one replica',
        'site must retain bounded memory and PID resources',
      ]),
    )
  })

  test('rejects quota, secret, image, and storage drift', () => {
    const topology = renderedTopology()
    const current = services(topology)
    const workerEnvironment = current['operations-worker'].environment as Record<string, string>
    const postgresBuild = current.postgres.build as Record<string, string>
    const secrets = topology.secrets as Record<string, unknown>

    workerEnvironment.BRAWLHALLA_V1_REQUEST_LIMIT = '150'
    workerEnvironment.OPERATIONS_TOTAL_CONCURRENCY = '1'
    postgresBuild.target = 'api'
    current.postgres.volumes = [{ source: '/', target: '/var/lib/postgresql/data', type: 'bind' }]
    current.api.secrets = []
    current.web.image = 'ghcr.io/nicktacke/brawltome-web:latest'
    current.api.build = { target: 'api' }
    secrets.extra = { file: '/tmp/extra' }

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('secrets must be exactly'),
        'api secrets must match approved attachments exactly',
        'operations-worker must retain the V1 safety ceiling of 1800 requests per five minutes',
        'operations-worker must retain four total operation slots',
        'postgres must use build target postgres',
        'web must use image ghcr.io/nicktacke/brawltome-web tagged with the release commit',
        'api must not be built on the server',
        'postgres must bind only the approved data filesystem',
      ]),
    )
  })

  test('rejects an image from a lookalike registry', () => {
    const topology = renderedTopology()
    const current = services(topology)

    current.web.image = `ghcrXio/nicktacke/brawltome-web:${'a'.repeat(40)}`

    expect(verifyAppRenderedTopology(topology)).toContain(
      'web must use image ghcr.io/nicktacke/brawltome-web tagged with the release commit',
    )
  })

  test('rejects hardening, raw-secret, and secret-shadowing drift', () => {
    const topology = renderedTopology()
    const current = services(topology)

    current.api.cap_add = ['SYS_ADMIN']
    current.api.cap_drop = []
    current.api.command = ['printenv']
    current.api.privileged = true
    current.api.user = '0:0'
    const apiEnvironment = current.api.environment as Record<string, string>

    apiEnvironment.DATABASE_URL = 'raw-secret'
    current.api.tmpfs = ['/run:rw']
    current.web.labels = 'traefik.enable=true'
    current.web.volumes = [{ source: '/', target: '/run/secrets', type: 'bind' }]

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'api must not add capabilities',
        'api must drop all capabilities',
        'api must not override the image user',
        'api must not set privileged mode',
        'api must not override the image command or entrypoint',
        'api must not receive raw secret environment variables',
        'api tmpfs must not shadow secret targets',
        'web labels must be an object',
        'web must not add volumes',
      ]),
    )
  })

  test('rejects dependency, health, drain, and resource drift', () => {
    const topology = renderedTopology()
    const current = services(topology)
    const webHealthcheck = current.web.healthcheck as Record<string, unknown>
    const workerDeploy = current['operations-worker'].deploy as Record<string, unknown>

    current.api.depends_on = {}
    webHealthcheck.test = ['CMD', 'false']
    current.postgres.stop_grace_period = '1s'
    workerDeploy.resources = {}

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'api dependencies must match the approved topology',
        'web health check must use /api/health/live',
        'postgres must retain stop grace period 30s',
        'operations-worker must retain bounded memory and PID resources',
      ]),
    )
  })

  test('keeps web routable through an API or database outage by probing liveness, not readiness', () => {
    const topology = renderedTopology()
    const webHealthcheck = services(topology).web.healthcheck as Record<string, unknown>

    webHealthcheck.test = [
      'CMD',
      'node',
      '-e',
      "fetch('http://localhost:3000/api/health/ready').then(r => { if (!r.ok) process.exit(1) })",
    ]

    expect(verifyAppRenderedTopology(topology)).toContain('web health check must use /api/health/live')
  })

  test('rejects malformed service shapes and profile leakage', () => {
    const topology = renderedTopology()
    const current = topology.services as Record<string, unknown>
    const web = current.web as Record<string, unknown>

    current.api = null
    web.ports = {}

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining(['api must be a service object', 'web must not publish ports']),
    )
  })
})

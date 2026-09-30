import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { verifyAppRenderedTopology } from '../verify-rendered-topology'

const root = resolve(import.meta.dir, '../../..')

function renderedTopology(): Record<string, unknown> {
  const result = Bun.spawnSync({
    cmd: ['docker', 'compose', '-f', 'infra/app/compose.yml', 'config', '--format', 'json'],
    cwd: root,
    env: {
      ...process.env,
      DISCORD_CLIENT_ID: '123456789012345678',
      POSTGRES_DATA_ROOT: '/srv/brawltome/postgres',
      TURNSTILE_SITE_KEY: 'test-site-key',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString())
}

function services(topology: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return topology.services as Record<string, Record<string, unknown>>
}

describe('rendered application topology', () => {
  test('accepts the exact internal-only four-unit rollout', () => {
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
    ['OPERATIONS_TOTAL_CONCURRENCY', '2', 'operations-worker must retain three total operation slots'],
    ['OPERATIONS_INTERACTIVE_RESERVATION', '2', 'operations-worker must retain one reserved interactive slot'],
    ['OPERATIONS_INTERACTIVE_CONCURRENCY', '1', 'operations-worker must retain two interactive operation slots'],
    ['OPERATIONS_LEADERBOARD_CONCURRENCY', '2', 'operations-worker must retain one leaderboard operation slot'],
    ['SOURCE_BACKGROUND_HEADROOM', '31', 'operations-worker must retain 30 source units of on-demand headroom'],
    ['SOURCE_UNAVAILABLE_RETRY_MS', '1000', 'operations-worker must retain the 60-second source outage deferral'],
  ] as const)('rejects independent %s rollout drift', (variable, value, violation) => {
    const topology = renderedTopology()
    ;(services(topology)['operations-worker'].environment as Record<string, string>)[variable] = value
    expect(verifyAppRenderedTopology(topology)).toContain(violation)
  })

  test('rejects Discord activation, public exposure, and extra networks', () => {
    const topology = renderedTopology()
    const current = services(topology)
    current['discord-bot'] = { networks: { application: null } }
    current.api.ports = [{ published: '3000', target: 3000 }]
    current.web.labels = { 'Traefik.enable': 'true' }
    ;(topology.networks as Record<string, unknown>).public = { external: true, name: 'dokploy-network' }

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('services must be exactly'),
        expect.stringContaining('networks must be exactly'),
        'api must not publish ports',
        'web must not have Traefik labels',
      ]),
    )
  })

  test('rejects quota, secret, image, and storage drift', () => {
    const topology = renderedTopology()
    const current = services(topology)
    ;(current['operations-worker'].environment as Record<string, string>).BRAWLHALLA_V1_REQUEST_LIMIT = '150'
    ;(current['operations-worker'].environment as Record<string, string>).OPERATIONS_TOTAL_CONCURRENCY = '1'
    ;(current.postgres.build as Record<string, string>).target = 'api'
    current.postgres.volumes = [{ source: '/', target: '/var/lib/postgresql/data', type: 'bind' }]
    current.api.secrets = []
    ;(topology.secrets as Record<string, unknown>).extra = { file: '/tmp/extra' }

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('secrets must be exactly'),
        'api secrets must match approved attachments exactly',
        'operations-worker must retain the V1 safety ceiling of 1800 requests per five minutes',
        'operations-worker must retain three total operation slots',
        'postgres must use build target postgres',
        'postgres must bind only the approved data filesystem',
      ]),
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
    ;(current.api.environment as Record<string, string>).DATABASE_URL = 'raw-secret'
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
    current.api.depends_on = {}
    ;(current.web.healthcheck as Record<string, unknown>).test = ['CMD', 'false']
    current.postgres.stop_grace_period = '1s'
    ;(current['operations-worker'].deploy as Record<string, unknown>).resources = {}

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'api dependencies must match the approved topology',
        'web health check must use /api/health/ready',
        'postgres must retain stop grace period 30s',
        'operations-worker must retain bounded memory and PID resources',
      ]),
    )
  })

  test('rejects malformed service shapes and profile leakage', () => {
    const topology = renderedTopology()
    const current = topology.services as Record<string, unknown>
    current.api = null
    ;(current.web as Record<string, unknown>).ports = {}

    expect(verifyAppRenderedTopology(topology)).toEqual(
      expect.arrayContaining(['api must be a service object', 'web must not publish ports']),
    )
  })
})

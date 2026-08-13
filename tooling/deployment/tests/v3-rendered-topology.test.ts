import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { verifyV3RenderedTopology } from '../src/verify-v3-rendered-topology'

const root = resolve(import.meta.dir, '../../..')

function renderedTopology(): Record<string, unknown> {
  const result = Bun.spawnSync({
    cmd: ['docker', 'compose', '-f', 'deploy/v3/compose.yml', 'config', '--format', 'json'],
    cwd: root,
    env: {
      ...process.env,
      V3_POSTGRES_DATA_ROOT: '/srv/brawltome-v3/postgres',
      V3_PUBLIC_API_URL: 'https://v3-api.brawltome.app',
      V3_TURNSTILE_SITE_KEY: 'test-site-key',
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

describe('rendered V3 deployment topology', () => {
  test('accepts the exact internal-only four-unit rollout', () => {
    expect(verifyV3RenderedTopology(renderedTopology())).toEqual([])
  })

  test('rejects collision-prone legacy runtime service names', () => {
    const topology = renderedTopology()
    const current = services(topology)
    current.api = current['v3-api']
    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining([expect.stringContaining('services must be exactly')]),
    )
  })

  test('rejects preview web origins after final public cutover', () => {
    const topology = renderedTopology()
    const environment = services(topology)['v3-api'].environment as Record<string, string>
    environment.CORS_ORIGIN = 'https://v3.brawltome.app'
    environment.WEB_ORIGIN = 'https://v3.brawltome.app'

    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'api must allow only the final public web origin',
        'api must use the final public web origin',
      ]),
    )
  })

  test.each([
    ['BRAWLHALLA_V1_REQUEST_LIMIT', '1', 'operations-worker must retain the staged Brawlhalla ceiling of 102'],
    ['LEADERBOARD_PAGE_DEPTH', '1', 'operations-worker must retain adaptive leaderboard depth 20'],
    ['LEADERBOARD_INTERVAL_MS', '900000', 'operations-worker must retain hourly leaderboard cadence'],
    ['OPERATIONS_TOTAL_CONCURRENCY', '3', 'operations-worker must retain two total operation slots'],
    ['OPERATIONS_INTERACTIVE_RESERVATION', '2', 'operations-worker must retain one reserved interactive slot'],
    ['OPERATIONS_INTERACTIVE_CONCURRENCY', '1', 'operations-worker must retain two interactive operation slots'],
    ['OPERATIONS_LEADERBOARD_CONCURRENCY', '2', 'operations-worker must retain one leaderboard operation slot'],
    ['SOURCE_BACKGROUND_HEADROOM', '31', 'operations-worker must retain 30 source units of on-demand headroom'],
    ['SOURCE_UNAVAILABLE_RETRY_MS', '1000', 'operations-worker must retain the 60-second source outage deferral'],
  ] as const)('rejects independent %s rollout drift', (variable, value, violation) => {
    const topology = renderedTopology()
    ;(services(topology)['v3-operations-worker'].environment as Record<string, string>)[variable] = value
    expect(verifyV3RenderedTopology(topology)).toContain(violation)
  })

  test('rejects Discord activation, public exposure, and extra networks', () => {
    const topology = renderedTopology()
    const current = services(topology)
    current['v3-discord-bot'] = { networks: { application: null } }
    current['v3-api'].ports = [{ published: '3000', target: 3000 }]
    current['v3-web'].labels = { 'Traefik.enable': 'true' }
    ;(topology.networks as Record<string, unknown>).public = { external: true, name: 'dokploy-network' }

    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('services must be exactly'),
        expect.stringContaining('networks must be exactly'),
        'v3-api must not publish ports',
        'v3-web must not have Traefik labels',
      ]),
    )
  })

  test('rejects quota, secret, image, and storage drift', () => {
    const topology = renderedTopology()
    const current = services(topology)
    ;(current['v3-operations-worker'].environment as Record<string, string>).BRAWLHALLA_V1_REQUEST_LIMIT = '150'
    ;(current['v3-operations-worker'].environment as Record<string, string>).OPERATIONS_TOTAL_CONCURRENCY = '1'
    ;(current.postgres.build as Record<string, string>).target = 'api'
    current.postgres.volumes = [{ source: '/', target: '/var/lib/postgresql/data', type: 'bind' }]
    current['v3-api'].secrets = []
    ;(topology.secrets as Record<string, unknown>).extra = { file: '/tmp/extra' }

    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('secrets must be exactly'),
        'v3-api secrets must match approved attachments exactly',
        'operations-worker must retain the staged Brawlhalla ceiling of 102',
        'operations-worker must retain two total operation slots',
        'postgres must use build target postgres',
        'postgres must bind only the approved data filesystem',
      ]),
    )
  })

  test('rejects hardening, raw-secret, and secret-shadowing drift', () => {
    const topology = renderedTopology()
    const current = services(topology)
    current['v3-api'].cap_add = ['SYS_ADMIN']
    current['v3-api'].cap_drop = []
    current['v3-api'].command = ['printenv']
    current['v3-api'].privileged = true
    current['v3-api'].user = '0:0'
    ;(current['v3-api'].environment as Record<string, string>).DATABASE_URL = 'raw-secret'
    current['v3-api'].tmpfs = ['/run:rw']
    current['v3-web'].labels = 'traefik.enable=true'
    current['v3-web'].volumes = [{ source: '/', target: '/run/secrets', type: 'bind' }]

    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'v3-api must not add capabilities',
        'v3-api must drop all capabilities',
        'v3-api must not override the image user',
        'v3-api must not set privileged mode',
        'v3-api must not override the image command or entrypoint',
        'v3-api must not receive raw secret environment variables',
        'v3-api tmpfs must not shadow secret targets',
        'v3-web labels must be an object',
        'v3-web must not add volumes',
      ]),
    )
  })

  test('rejects malformed service shapes and profile leakage', () => {
    const topology = renderedTopology()
    const current = topology.services as Record<string, unknown>
    current['v3-api'] = null
    ;(current['v3-web'] as Record<string, unknown>).ports = {}

    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining(['v3-api must be a service object', 'v3-web must not publish ports']),
    )
  })
})

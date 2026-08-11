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

  test.each([
    ['BRAWLHALLA_V1_REQUEST_LIMIT', '2', 'operations-worker must retain the limit-1 Brawlhalla request control'],
    ['OPERATIONS_TOTAL_CONCURRENCY', '3', 'operations-worker must retain two total operation slots'],
    ['OPERATIONS_INTERACTIVE_RESERVATION', '2', 'operations-worker must retain one reserved interactive slot'],
    ['OPERATIONS_INTERACTIVE_CONCURRENCY', '1', 'operations-worker must retain two interactive operation slots'],
  ] as const)('rejects independent %s rollout drift', (variable, value, violation) => {
    const topology = renderedTopology()
    ;(services(topology)['operations-worker'].environment as Record<string, string>)[variable] = value
    expect(verifyV3RenderedTopology(topology)).toContain(violation)
  })

  test('rejects Discord activation, public exposure, and extra networks', () => {
    const topology = renderedTopology()
    const current = services(topology)
    current['discord-bot'] = { networks: { application: null } }
    current.api.ports = [{ published: '3000', target: 3000 }]
    current.web.labels = { 'Traefik.enable': 'true' }
    ;(topology.networks as Record<string, unknown>).public = { external: true, name: 'dokploy-network' }

    expect(verifyV3RenderedTopology(topology)).toEqual(
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

    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('secrets must be exactly'),
        'api secrets must match approved attachments exactly',
        'operations-worker must retain the limit-1 Brawlhalla request control',
        'operations-worker must retain two total operation slots',
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

    expect(verifyV3RenderedTopology(topology)).toEqual(
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

  test('rejects malformed service shapes and profile leakage', () => {
    const topology = renderedTopology()
    const current = topology.services as Record<string, unknown>
    current.api = null
    ;(current.web as Record<string, unknown>).ports = {}

    expect(verifyV3RenderedTopology(topology)).toEqual(
      expect.arrayContaining(['api must be a service object', 'web must not publish ports']),
    )
  })
})
